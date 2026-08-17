import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Icon } from '../components/Icon.jsx'
import { generateSessionPlan } from '../lib/ai.js'
import {
  arrangeSession,
  completeSession,
  getLearningRequest,
  getSessionsByMatchIds,
  listAllFeedback,
  listMatchRequests,
  listUsers,
  respondToMatchRequest,
  saveSessionPlan,
  submitFeedback,
} from '../lib/firestore.js'

export function Requests() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [sessions, setSessions] = useState([])
  const [feedback, setFeedback] = useState([])
  const [usersById, setUsersById] = useState({})
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [result, users] = await Promise.all([listMatchRequests(user.userId), listUsers()])
      const matchIds = [...result.incoming, ...result.outgoing].map((r) => r.matchId)
      const [arranged, allFeedback] = await Promise.all([
        matchIds.length ? getSessionsByMatchIds(matchIds) : [],
        listAllFeedback(),
      ])
      setIncoming(result.incoming)
      setOutgoing(result.outgoing)
      setSessions(arranged)
      setFeedback(allFeedback.filter((f) => matchIds.includes(f.sessionId)))
      setUsersById(Object.fromEntries(users.map((u) => [u.userId, u])))
    } catch (err) {
      setError(err.message || 'Could not load your requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.userId])

  async function respond(matchId, status) {
    setBusyId(matchId)
    try {
      await respondToMatchRequest(matchId, status)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function arrange(matchId) {
    setBusyId(matchId)
    try {
      await arrangeSession(matchId, {})
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

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

  const sessionFor = (matchId) => sessions.find((s) => s.matchId === matchId)
  const feedbackFrom = (matchId, fromUser) => feedback.find((f) => f.sessionId === matchId && f.fromUser === fromUser)

  const groups = { pending: [], upcoming: [], awaiting: [], completed: [], closed: [] }
  function bucket(list, role) {
    for (const r of list) {
      const session = sessionFor(r.matchId)
      const row = { r, session, role }
      if (r.status === 'pending') groups.pending.push(row)
      else if (r.status === 'rejected') groups.closed.push(row)
      else if (session?.status === 'completed') groups.completed.push(row)
      else if (session?.status === 'arranged') groups.upcoming.push(row)
      else groups.awaiting.push(row)
    }
  }
  bucket(incoming, 'tutor')
  bucket(outgoing, 'student')

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">MY SESSIONS</p>
          <h1>Requests &amp; sessions</h1>
          <p className="sub">Everything you've sent and received, in one place.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : incoming.length === 0 && outgoing.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <p>
            Nothing here yet. Head to your <Link to="/dashboard">Dashboard</Link> to find a tutor, or wait for someone to request tutoring from you.
          </p>
        </div>
      ) : (
        <div className="req-groups">
          <ReqGroup title="Upcoming sessions" icon="calendar" rows={groups.upcoming} {...common()} />
          <ReqGroup title="Awaiting your response" icon="message" rows={groups.pending} {...common()} />
          <ReqGroup title="Accepted — needs a session" icon="check" rows={groups.awaiting} {...common()} />
          <ReqGroup title="Completed" icon="spark" rows={groups.completed} {...common()} />
          <ReqGroup title="Declined" icon="x" rows={groups.closed} {...common()} collapsedByDefault />
        </div>
      )}
    </>
  )

  function common() {
    return {
      usersById,
      busyId,
      onRespond: respond,
      onArrange: arrange,
      onComplete: complete,
      onFeedback: leaveFeedback,
      onSavePlan: savePlan,
      feedbackFrom,
      myId: user.userId,
    }
  }
}

function ReqGroup({ title, icon, rows, collapsedByDefault, ...rowProps }) {
  const [open, setOpen] = useState(!collapsedByDefault)
  if (!rows.length) return null
  return (
    <div className="requests">
      <div className="section-heading">
        <h2>
          <Icon name={icon} size={16} /> {title}
        </h2>
        <span className="count">{rows.length}</span>
      </div>
      {open ? (
        rows.map(({ r, session, role }) => (
          <RequestRow key={r.matchId} r={r} session={session} role={role} {...rowProps} />
        ))
      ) : (
        <button className="view-tutors" onClick={() => setOpen(true)}>
          Show {rows.length} <Icon name="chevron" size={14} />
        </button>
      )}
    </div>
  )
}

function RequestRow({ r, session, role, usersById, busyId, onRespond, onArrange, onComplete, onFeedback, onSavePlan, feedbackFrom, myId }) {
  const busy = busyId === r.matchId
  const otherId = role === 'tutor' ? r.studentId : r.tutorId
  const other = usersById[otherId]
  const myFeedback = session?.status === 'completed' ? feedbackFrom(r.matchId, myId) : null

  return (
    <div className="request-card">
      <div className="request-mini">
        <div>
          <b>{r.moduleName}</b>
          <small>
            {role === 'tutor' ? 'From' : 'To'} {other?.name || other?.email || 'a NYPkaki student'} · Status: {r.status}
            {session ? ` · ${session.day} ${session.startTime}–${session.endTime} · ${session.location}` : ''}
          </small>
        </div>
        <div className="request-actions">
          {r.status === 'pending' && role === 'tutor' && (
            <>
              <button disabled={busy} onClick={() => onRespond(r.matchId, 'accepted')}>Accept</button>
              <button className="outline" disabled={busy} onClick={() => onRespond(r.matchId, 'rejected')}>Decline</button>
            </>
          )}
          {r.status === 'accepted' && !session && (
            <button disabled={busy} onClick={() => onArrange(r.matchId)}>Arrange session</button>
          )}
          {session?.status === 'arranged' && (
            <button className="outline" disabled={busy} onClick={() => onComplete(r.matchId)}>Mark as completed</button>
          )}
        </div>
      </div>

      {session?.status === 'arranged' && (
        <SessionPlanPanel matchId={r.matchId} r={r} session={session} role={role} busy={busy} onSave={onSavePlan} />
      )}
      {session?.plan && session.status === 'completed' && <PlanReadOnly plan={session.plan} />}

      {session?.status === 'completed' && !myFeedback && (
        <FeedbackForm matchId={r.matchId} otherId={otherId} other={other} busy={busy} onSubmit={onFeedback} />
      )}
      {myFeedback && (
        <p className="recommend-copy feedback-left">
          You rated this session {myFeedback.rating}/5 {myFeedback.helpful ? '· found it helpful' : ''}
        </p>
      )}
    </div>
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
        Leave feedback for {other?.name || 'them'} <Icon name="spark" size={14} />
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
