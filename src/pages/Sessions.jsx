import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Icon } from '../components/Icon.jsx'
import { generateSessionPlan } from '../lib/ai.js'
import {
  completeSession,
  getLearningRequest,
  getSessionsByMatchIds,
  listAllFeedback,
  listMatchRequests,
  listUsers,
  saveSessionPlan,
  submitFeedback,
} from '../lib/firestore.js'

export function Sessions() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [feedback, setFeedback] = useState([])
  const [busyId, setBusyId] = useState(null)

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
      const [sessions, allFeedback] = await Promise.all([
        matchIds.length ? getSessionsByMatchIds(matchIds) : [],
        listAllFeedback(),
      ])
      const sessionByMatch = Object.fromEntries(sessions.map((s) => [s.matchId, s]))
      const withSessions = combined
        .map(({ r, role }) => ({ r, role, session: sessionByMatch[r.matchId], other: usersById[role === 'tutor' ? r.studentId : r.tutorId] }))
        .filter(({ session }) => session && session.status !== 'cancelled')
        .sort((a, b) => {
          if (a.session.status !== b.session.status) return a.session.status === 'arranged' ? -1 : 1
          return (a.session.day + a.session.startTime).localeCompare(b.session.day + b.session.startTime)
        })
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

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">SESSIONS</p>
          <h1>Your tutoring sessions</h1>
          <p className="sub">Everything arranged and completed, with plans and feedback in one place.</p>
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
            onSavePlan={savePlan}
          />
          <SessionGroup
            title="Completed"
            icon="check"
            rows={completed}
            busyId={busyId}
            onFeedback={leaveFeedback}
            feedbackFrom={feedbackFrom}
            myId={user.userId}
            completedGroup
          />
        </div>
      )}
    </>
  )
}

function SessionGroup({ title, icon, rows, busyId, onComplete, onSavePlan, onFeedback, feedbackFrom, myId, completedGroup }) {
  if (!rows.length) return null
  return (
    <div className="requests">
      <div className="section-heading">
        <h2><Icon name={icon} size={16} /> {title}</h2>
        <span className="count">{rows.length}</span>
      </div>
      {rows.map(({ r, session, role, other }) => (
        <div className="request-card" key={r.matchId}>
          <div className="request-mini">
            <div>
              <b>{r.moduleName}</b>
              <small>
                With {other?.name || other?.email || 'a NYPkaki student'} · {session.day} {session.startTime}–{session.endTime} · {session.location}
              </small>
            </div>
            {!completedGroup && (
              <div className="request-actions">
                <button className="outline" disabled={busyId === r.matchId} onClick={() => onComplete(r.matchId)}>
                  Mark as completed
                </button>
              </div>
            )}
          </div>

          {!completedGroup && (
            <SessionPlanPanel matchId={r.matchId} r={r} session={session} role={role} busy={busyId === r.matchId} onSave={onSavePlan} />
          )}
          {completedGroup && session.plan && <PlanReadOnly plan={session.plan} />}

          {completedGroup && (
            <FeedbackSection matchId={r.matchId} otherId={role === 'tutor' ? r.studentId : r.tutorId} other={other} busy={busyId === r.matchId} onSubmit={onFeedback} feedbackFrom={feedbackFrom} myId={myId} />
          )}
        </div>
      ))}
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
          {generating ? 'Generating…' : 'Generate session plan'} <Icon name="spark" size={14} />
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
      <p className="plan-goal">{plan.goal}</p>
      <ol className="plan-blocks">
        {plan.blocks.map((b, i) => (
          <li key={i}>
            {editing ? (
              <>
                <input value={b.label} onChange={(e) => updateBlock(i, 'label', e.target.value)} />
                <textarea value={b.description} onChange={(e) => updateBlock(i, 'description', e.target.value)} />
              </>
            ) : (
              <>
                <b>{b.label}</b>
                <span>{b.description}</span>
              </>
            )}
          </li>
        ))}
      </ol>
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
