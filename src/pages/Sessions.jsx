import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Icon } from '../components/Icon.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { AddToCalendar } from '../components/AddToCalendar.jsx'
import { ContactFallback } from '../components/ContactFallback.jsx'
import { generateSessionPlan } from '../lib/ai.js'
import {
  cancelSession,
  completeSession,
  editSession,
  getLearningRequest,
  getSessionsByMatchIds,
  listAllFeedback,
  listMatchRequests,
  listUsers,
  saveSessionPlan,
  submitFeedback,
} from '../lib/firestore.js'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function scoreBand(score) {
  return score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'possible' : 'low'
}

export function Sessions() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [rows, setRows] = useState([])
  const [feedback, setFeedback] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [detailRow, setDetailRow] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')

  // silent=true on action-triggered refreshes so the list doesn't unmount behind the
  // full-page spinner — that was collapsing the page and resetting scroll right after
  // clicking Cancel/Complete/Edit, with nothing telling you what had just happened.
  async function load(silent) {
    if (!silent) setLoading(true)
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
        // Same as Requests.jsx: the other person's account may have since been
        // deleted, so skip rows that would otherwise reference a nonexistent user.
        .filter(({ session, other }) => session && other)
        .sort((a, b) => (a.session.day + a.session.startTime).localeCompare(b.session.day + b.session.startTime))
      setRows(withSessions)
      setFeedback(allFeedback.filter((f) => matchIds.includes(f.sessionId)))
    } catch (err) {
      setError(err.message || 'Could not load your sessions.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.userId])

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(''), 5000)
    return () => clearTimeout(t)
  }, [success])

  async function complete(matchId) {
    setBusyId(matchId)
    setError('')
    try {
      await completeSession(matchId)
      setSuccess('Marked as completed — moved to Completed.')
      await load(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(matchId) {
    setBusyId(matchId)
    setError('')
    try {
      await cancelSession(matchId)
      setSuccess('Session cancelled — moved to Cancelled.')
      await load(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function edit(matchId, details) {
    setBusyId(matchId)
    setError('')
    try {
      await editSession(matchId, details)
      setEditingId(null)
      setSuccess(`Session updated — now ${details.day} ${details.startTime}–${details.endTime}.`)
      await load(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function leaveFeedback(matchId, toUser, { rating, helpful, comment }) {
    setBusyId(matchId)
    setError('')
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
      setSuccess('Feedback submitted — thanks!')
      await load(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function savePlan(matchId, plan) {
    setBusyId(matchId)
    setError('')
    try {
      await saveSessionPlan(matchId, plan)
      setSuccess('Session plan saved.')
      await load(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const feedbackFrom = (matchId, fromUser) => feedback.find((f) => f.sessionId === matchId && f.fromUser === fromUser)
  const q = search.trim().toLowerCase()
  const searched = q
    ? rows.filter(({ r, other }) => (r.moduleName || '').toLowerCase().includes(q) || (other.name || other.email || '').toLowerCase().includes(q))
    : rows
  const upcoming = searched.filter((row) => row.session.status === 'arranged')
  const completed = searched.filter((row) => row.session.status === 'completed')
  const cancelled = searched.filter((row) => row.session.status === 'cancelled')

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
      {success && <Banner kind="info">{success}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📅</span>
          <p>No sessions yet. Once a tutoring request is accepted and arranged, it'll show up here.</p>
        </div>
      ) : (
        <>
          {rows.length > 6 && (
            <label className="field req-search">
              Search by person or module
              <div className="search-input">
                <Icon name="search" size={15} />
                <input placeholder="e.g. Chloe or Databases…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </label>
          )}
          {q && searched.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon">🔍</span>
              <p>No sessions match "{search}".</p>
            </div>
          )}
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
            editingId={editingId}
            onStartEdit={setEditingId}
            onEdit={edit}
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
        </>
      )}

      {detailRow && <SessionDetailModal {...detailRow} onClose={() => setDetailRow(null)} />}
    </>
  )
}

function SessionGroup({ title, icon, rows, busyId, onComplete, onCancel, onSavePlan, onFeedback, feedbackFrom, myId, onView, completedGroup, cancelledGroup, collapsedByDefault, editingId, onStartEdit, onEdit }) {
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
          const isEditing = editingId === r.matchId
          return (
            <div className="request-card" key={r.matchId}>
              <div className="request-mini">
                <div className="request-who">
                  <Avatar name={other?.name || other?.email} id={other?.userId} small />
                  <div>
                    <b>{r.moduleName}</b>
                    <small>
                      With {other.name || other.email} · {session.day} {session.startTime}–{session.endTime} ·{' '}
                      {session.format === 'online' ? 'Online' : 'In-person'} · {session.location}
                    </small>
                  </div>
                </div>
                {!isEditing && (
                  <div className="request-actions">
                    <button className="outline" onClick={() => onView(row)}>View Session</button>
                    {!completedGroup && !cancelledGroup && (
                      <>
                        <button className="outline" disabled={busyId === r.matchId} onClick={() => onStartEdit(r.matchId)}>
                          <Icon name="edit" size={13} /> Edit
                        </button>
                        <button className="outline danger-btn" disabled={busyId === r.matchId} onClick={() => onCancel(r.matchId)}>Cancel</button>
                        <button disabled={busyId === r.matchId} onClick={() => onComplete(r.matchId)}>Mark Completed</button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {isEditing && (
                <EditSessionForm
                  matchId={r.matchId}
                  session={session}
                  busy={busyId === r.matchId}
                  onSave={onEdit}
                  onCancel={() => onStartEdit(null)}
                />
              )}

              {!completedGroup && !cancelledGroup && !isEditing && session.format === 'online' && (
                <p className="recommend-copy zoom-note">
                  {session.zoomLink ? (
                    <a href={session.zoomLink} target="_blank" rel="noreferrer" className="zoom-link">
                      <Icon name="location" size={12} /> Join Zoom Meeting
                    </a>
                  ) : (
                    <><Icon name="clock" size={12} /> Zoom link is being generated — check back in a moment.</>
                  )}
                </p>
              )}

              {topics.length > 0 && (
                <div className="chips request-topics">
                  {topics.map((t) => <span key={t}>{t}</span>)}
                </div>
              )}

              {!completedGroup && !cancelledGroup && !isEditing && (
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

function EditSessionForm({ matchId, session, busy, onSave, onCancel }) {
  const [day, setDay] = useState(session.day)
  const [startTime, setStartTime] = useState(session.startTime)
  const [endTime, setEndTime] = useState(session.endTime)
  const [format, setFormat] = useState(session.format)
  const [location, setLocation] = useState(session.format === 'online' ? '' : session.location)

  return (
    <div className="arrange-form">
      <div className="arrange-grid">
        <label className="field">
          Day
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="field">
          Start
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="field">
          End
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
        <label className="field">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="in-person">In-person</option>
            <option value="online">Online</option>
          </select>
        </label>
        <label className="field arrange-location">
          {format === 'online' ? 'Notes (optional)' : 'Location'}
          <input
            placeholder={format === 'online' ? 'e.g. Same Zoom link as before' : 'e.g. Campus library'}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
      </div>
      {format === 'online' && session.format !== 'online' && (
        <p className="recommend-copy arrange-zoom-hint">
          Switching to online here doesn't generate a new Zoom link automatically — that only happens when a session
          is first arranged. Share a link manually, or note it above.
        </p>
      )}
      <div className="arrange-actions">
        <button className="outline" disabled={busy} onClick={onCancel}>Cancel</button>
        <button
          disabled={busy || endTime <= startTime}
          onClick={() => onSave(matchId, { day, startTime, endTime, format, location: location || (format === 'online' ? 'Online' : 'Campus library') })}
        >
          {busy ? <Spinner /> : 'Save changes'}
        </button>
      </div>
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
            <h2>{other?.name || other?.email || 'This account'}</h2>
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
            <div><span className="tutor-topics-label">Location</span><b>{session.location}</b></div>
          </div>
          {session.format === 'online' && (
            <p className="recommend-copy zoom-note">
              {session.zoomLink ? (
                <a href={session.zoomLink} target="_blank" rel="noreferrer" className="zoom-link">
                  <Icon name="location" size={12} /> Join Zoom Meeting
                </a>
              ) : (
                <><Icon name="clock" size={12} /> Zoom link is being generated — check back in a moment.</>
              )}
            </p>
          )}
          {session.status === 'arranged' && (
            <AddToCalendar
              className="modal-add-to-calendar"
              event={{
                title: `${r.moduleName} with ${other?.name || other?.email || 'your match'}`,
                description: `NYPkaki tutoring session${session.zoomLink ? ` — join: ${session.zoomLink}` : ''}`,
                location: session.format === 'online' ? session.zoomLink || 'Online' : session.location,
                day: session.day,
                startTime: session.startTime,
                endTime: session.endTime,
              }}
            />
          )}
          <ContactFallback user={other} />
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
