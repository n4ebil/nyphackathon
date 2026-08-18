import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Icon } from '../components/Icon.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { generateSessionPlan } from '../lib/ai.js'
import {
  cancelSession,
  completeSession,
  getLearningRequest,
  getSessionsByMatchIds,
  listAllFeedback,
  listMatchRequests,
  listUsers,
  saveSessionPlan,
  submitFeedback,
} from '../lib/firestore.js'

function scoreBand(score) {
  return score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'possible' : 'low'
}

export function Sessions() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [feedback, setFeedback] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [detailRow, setDetailRow] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [result, users] = await Promise.all([listMatchRequests(user.userId), listUsers()])
      const usersById = Object.fromEntries(users.map((u) => [u.userId, u]))
      const combined = [
        ...result.incoming.map((r) => ({ r, role: 'tutor' })),
        ...result.outgoing.map((r) => ({ r, role: 'student' })),
      ]
      const matchIds = combined.map(({ r }) => r.matchId)
      const [sessions, allFeedback, learningRequests] = await Promise.all([
        matchIds.length ? getSessionsByMatchIds(matchIds) : [],
        listAllFeedback(),
        Promise.all(combined.map(({ r }) => getLearningRequest(r.matchId.split('--')[0]))),
      ])
      const sessionByMatch = Object.fromEntries(sessions.map((s) => [s.matchId, s]))
      const withSessions = combined
        .map(({ r, role }, i) => ({
          r,
          role,
          session: sessionByMatch[r.matchId],
          other: usersById[role === 'tutor' ? r.studentId : r.tutorId],
          topics: learningRequests[i]?.topics || [],
        }))
        .filter(({ session }) => session)
        .sort((a, b) => (a.session.day + a.session.startTime).localeCompare(b.session.day + b.session.startTime))
      setRows(withSessions)
      setFeedback(allFeedback.filter((f) => matchIds.includes(f.sessionId)))
    } catch (err) {
      setError(err.message || 'Could not load your sessions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.userId])

  async function complete(matchId) {
    setBusyId(matchId)
    try {
      await completeSession(matchId)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(matchId) {
    setBusyId(matchId)
    try {
      await cancelSession(matchId)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function leaveFeedback(matchId, toUser, { rating, helpful, comment }) {
    setBusyId(matchId)
    try {
      await submitFeedback({
        sessionId: matchId,
        fromUser: user.userId,
        toUser,
        rating,
        helpful,
        comment,
        createdAt: new Date().toISOString(),
      })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function savePlan(matchId, plan) {
    setBusyId(matchId)
    try {
      await saveSessionPlan(matchId, plan)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const feedbackFrom = (matchId, fromUser) => feedback.find((f) => f.sessionId === matchId && f.fromUser === fromUser)
  const upcoming = rows.filter((row) => row.session.status === 'arranged')
  const completed = rows.filter((row) => row.session.status === 'completed')
  const cancelled = rows.filter((row) => row.session.status === 'cancelled')

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">SESSIONS</p>
          <h1>Your tutoring sessions</h1>
          <p className="sub">Upcoming, completed and cancelled — with plans and feedback in one place.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📅</span>
          <p>No sessions yet. Once a tutoring request is accepted and arranged, it'll show up here.</p>
        </div>
      ) : (
        <div className="req-groups">
          <SessionGroup
            title="Upcoming"
            icon="clock"
            rows={upcoming}
            busyId={busyId}
            onComplete={complete}
            onCancel={cancel}
            onSavePlan={savePlan}
            onView={setDetailRow}
          />
          <SessionGroup
            title="Completed"
            icon="check"
            rows={completed}
            busyId={busyId}
            onFeedback={leaveFeedback}
            feedbackFrom={feedbackFrom}
            myId={user.userId}
            onView={setDetailRow}
            completedGroup
          />
          <SessionGroup
            title="Cancelled"
            icon="x"
            rows={cancelled}
            busyId={busyId}
            onView={setDetailRow}
            collapsedByDefault
            cancelledGroup
          />
        </div>
      )}

      {detailRow && <SessionDetailModal {...detailRow} onClose={() => setDetailRow(null)} />}
    </>
  )
}

function SessionGroup({ title, icon, rows, busyId, onComplete, onCancel, onSavePlan, onFeedback, feedbackFrom, myId, onView, completedGroup, cancelledGroup, collapsedByDefault }) {
  const [open, setOpen] = useState(!collapsedByDefault)
  if (!rows.length) return null
  return (
    <div className="requests">
      <div className="section-heading">
        <h2><Icon name={icon} size={16} /> {title}</h2>
        <span className="count">{rows.length}</span>
      </div>
      {!open ? (
        <button className="view-tutors" onClick={() => setOpen(true)}>
          Show {rows.length} <Icon name="chevron" size={14} />
        </button>
      ) : (
        rows.map((row) => {
          const { r, session, role, other, topics } = row
          return (
            <div className="request-card" key={r.matchId}>
              <div className="request-mini">
                <div className="request-who">
                  <Avatar name={other?.name || other?.email} id={other?.userId} small />
                  <div>
                    <b>{r.moduleName}</b>
                    <small>
                      With {other?.name || other?.email || 'a NYPkaki student'} · {session.day} {session.startTime}–{session.endTime} ·{' '}
                      {session.format === 'online' ? 'Online' : 'In-person'} · {session.location}
                    </small>
                  </div>
                </div>
                <div className="request-actions">
                  <button className="outline" onClick={() => onView(row)}>View Session</button>
                  {!completedGroup && !cancelledGroup && (
                    <>
                      <button className="outline danger-btn" disabled={busyId === r.matchId} onClick={() => onCancel(r.matchId)}>Cancel</button>
                      <button disabled={busyId === r.matchId} onClick={() => onComplete(r.matchId)}>Mark Completed</button>
                    </>
                  )}
                </div>
              </div>

              {topics.length > 0 && (
                <div className="chips request-topics">
                  {topics.map((t) => <span key={t}>{t}</span>)}
                </div>
              )}

              {!completedGroup && !cancelledGroup && (
                <SessionPlanPanel matchId={r.matchId} r={r} session={session} role={role} busy={busyId === r.matchId} onSave={onSavePlan} />
              )}
              {completedGroup && session.plan && <PlanReadOnly plan={session.plan} />}

              {completedGroup && (
                <FeedbackSection matchId={r.matchId} otherId={role === 'tutor' ? r.studentId : r.tutorId} other={other} busy={busyId === r.matchId} onSubmit={onFeedback} feedbackFrom={feedbackFrom} myId={myId} />
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function SessionDetailModal({ r, session, role, other, topics, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><Icon name="x" size={16} /></button>
        <div className="modal-head">
          <Avatar name={other?.name || other?.email} id={other?.userId} />
          <div>
            <h2>{other?.name || 'A NYPkaki student'}</h2>
            <p className="course">{role === 'tutor' ? 'Your student' : 'Your tutor'}</p>
          </div>
        </div>

        <div className="tutor-stats-row modal-stats">
          <span className={'status-badge ' + session.status}>{session.status}</span>
          {r.score != null && (
            <span className={'score-pill sm ' + scoreBand(r.score)}><b>{r.score}% match</b></span>
          )}
        </div>

        <div className="modal-section">
          <h3>{r.moduleName}</h3>
          {topics.length > 0 && (
            <div className="chips">{topics.map((t) => <span key={t}>{t}</span>)}</div>
          )}
        </div>

        <div className="modal-section">
          <h3>Session details</h3>
          <div className="detail-grid">
            <div><span className="tutor-topics-label">Day</span><b>{session.day}</b></div>
            <div><span className="tutor-topics-label">Time</span><b>{session.startTime}–{session.endTime}</b></div>
            <div><span className="tutor-topics-label">Format</span><b>{session.format === 'online' ? 'Online' : 'In-person'}</b></div>
            <div><span className="tutor-topics-label">{session.format === 'online' ? 'Link' : 'Location'}</span><b>{session.location}</b></div>
          </div>
        </div>

        {session.plan && (
          <div className="modal-section">
            <h3>Session plan</h3>
            <p className="plan-goal">{session.plan.goal}</p>
            <PlanBlocks blocks={session.plan.blocks} />
          </div>
        )}
      </div>
    </div>
  )
}

function FeedbackSection({ matchId, otherId, other, busy, onSubmit, feedbackFrom, myId }) {
  const mine = feedbackFrom(matchId, myId)
  if (mine) {
    return (
      <p className="recommend-copy feedback-left">
        You rated this session {mine.rating}/5 {mine.helpful ? '· found it helpful' : ''}
      </p>
    )
  }
  return <FeedbackForm matchId={matchId} otherId={otherId} other={other} busy={busy} onSubmit={onSubmit} />
}

const STAGE_ICON = { warmup: 'clock', concepts: 'book', practice: 'edit', questions: 'message', recap: 'check' }

/** Renders plan blocks; falls back gracefully for plans saved before the stage/title fields existed. */
function PlanBlocks({ blocks, editing, onUpdate }) {
  return (
    <ol className="plan-blocks">
      {blocks.map((b, i) => (
        <li key={i}>
          <div className="plan-block-head">
            <span className="plan-block-icon"><Icon name={STAGE_ICON[b.stage] || 'spark'} size={12} /></span>
            <b>{b.title || 'Session block'}</b>
            {editing ? (
              <input className="plan-block-time" value={b.label} onChange={(e) => onUpdate(i, 'label', e.target.value)} />
            ) : (
              <span className="plan-block-time">{b.label}</span>
            )}
          </div>
          {editing ? (
            <textarea value={b.description} onChange={(e) => onUpdate(i, 'description', e.target.value)} />
          ) : (
            <p>{b.description}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

function SessionPlanPanel({ matchId, r, session, role, busy, onSave }) {
  const [plan, setPlan] = useState(session.plan || null)
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState(false)
  const isTutor = role === 'tutor'

  async function generate() {
    setGenerating(true)
    try {
      const request = await getLearningRequest(matchId.split('--')[0])
      const generated = await generateSessionPlan({
        moduleName: r.moduleName,
        topics: request?.topics || [],
        description: request?.description || r.message || r.moduleName,
        goal: request?.goal,
        durationMinutes: request?.duration,
      })
      setPlan(generated)
      await onSave(matchId, generated)
    } finally {
      setGenerating(false)
    }
  }

  function updateBlock(i, field, value) {
    setPlan((p) => ({ ...p, blocks: p.blocks.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)) }))
  }

  if (!plan) {
    return (
      <div className="plan-panel empty">
        <p className="recommend-copy">No session plan yet.</p>
        <button className="card-btn inline" disabled={generating || busy} onClick={generate}>
          {generating ? 'Generating…' : 'Generate Session Plan'} <Icon name="spark" size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="plan-panel">
      <div className="plan-header">
        <b>Session plan</b>
        {isTutor && (
          <button className="view-tutors" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done editing' : 'Edit'} <Icon name="edit" size={13} />
          </button>
        )}
      </div>
      {editing ? (
        <label className="field plan-goal-edit">
          Learning goal
          <input value={plan.goal} onChange={(e) => setPlan((p) => ({ ...p, goal: e.target.value }))} />
        </label>
      ) : (
        <p className="plan-goal">{plan.goal}</p>
      )}
      <PlanBlocks blocks={plan.blocks} editing={editing} onUpdate={updateBlock} />
      {editing && (
        <button className="card-btn inline" disabled={busy} onClick={() => { onSave(matchId, plan); setEditing(false) }}>
          Save plan
        </button>
      )}
    </div>
  )
}

function PlanReadOnly({ plan }) {
  return (
    <div className="plan-panel readonly">
      <b>Session plan</b>
      <p className="plan-goal">{plan.goal}</p>
      <PlanBlocks blocks={plan.blocks} />
    </div>
  )
}

function FeedbackForm({ matchId, otherId, other, busy, onSubmit }) {
  const [rating, setRating] = useState(0)
  const [helpful, setHelpful] = useState(null)
  const [comment, setComment] = useState('')
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button className="card-btn inline" onClick={() => setOpen(true)}>
        Leave feedback for {other?.name || 'them'} <Icon name="star" size={14} />
      </button>
    )
  }

  return (
    <div className="feedback-form">
      <div className="stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={n <= rating ? 'star on' : 'star'} onClick={() => setRating(n)}>★</button>
        ))}
      </div>
      <div className="helpful-toggle">
        <span>Was this helpful?</span>
        <button type="button" className={helpful === true ? 'on' : ''} onClick={() => setHelpful(true)}>Yes</button>
        <button type="button" className={helpful === false ? 'on' : ''} onClick={() => setHelpful(false)}>No</button>
      </div>
      <textarea placeholder="Anything else worth mentioning? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button
        className="primary"
        disabled={busy || !rating || helpful === null}
        onClick={() => onSubmit(matchId, otherId, { rating, helpful, comment })}
      >
        Submit feedback
      </button>
    </div>
  )
}
