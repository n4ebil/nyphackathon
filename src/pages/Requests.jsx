import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Icon } from '../components/Icon.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { arrangeSession, getLearningRequest, getSessionsByMatchIds, listMatchRequests, listUsers, respondToMatchRequest } from '../lib/firestore.js'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function scoreBand(score) {
  return score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'possible' : 'low'
}

function formatRequestedAt(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Requests() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [rows, setRows] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [arrangingId, setArrangingId] = useState(null)
  const [search, setSearch] = useState('')

  // silent=true on every action-triggered refresh — the initial full-page spinner
  // (loading) briefly unmounts the whole list, which was collapsing the page and
  // resetting scroll to the top right after clicking Accept/Cancel/Arrange, with
  // no sense of what had just happened. Only the very first load needs it.
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
      const [sessions, learningRequests] = await Promise.all([
        matchIds.length ? getSessionsByMatchIds(matchIds) : [],
        Promise.all(combined.map(({ r }) => getLearningRequest(r.matchId.split('--')[0]))),
      ])
      const sessionByMatch = Object.fromEntries(sessions.map((s) => [s.matchId, s]))
      const withMeta = combined
        .map(({ r, role }, i) => ({
          r,
          role,
          session: sessionByMatch[r.matchId],
          other: usersById[role === 'tutor' ? r.studentId : r.tutorId],
          topics: learningRequests[i]?.topics || [],
        }))
        // The other person's account may have since been deleted (e.g. admin
        // cleanup) — their request/session records don't disappear with them,
        // so skip rendering rows that would otherwise show a nonexistent user.
        .filter((row) => row.other)
        // Newest first within every group — previously unsorted, so requests showed
        // in whatever order the API happened to return them, making it impossible
        // to tell which one you'd just acted on.
        .sort((a, b) => (b.r.createdAt || '').localeCompare(a.r.createdAt || ''))
      setRows(withMeta)
    } catch (err) {
      setError(err.message || 'Could not load your requests.')
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

  async function respond(matchId, status, successMessage) {
    setBusyId(matchId)
    setError('')
    try {
      await respondToMatchRequest(matchId, status)
      setSuccess(
        successMessage ||
          (status === 'accepted'
            ? 'Request accepted — moved to Accepted, ready to arrange a session.'
            : 'Request declined — moved to Declined.'),
      )
      await load(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function arrange(matchId, details) {
    setBusyId(matchId)
    setError('')
    try {
      await arrangeSession(matchId, details)
      setArrangingId(null)
      setSuccess(`Session arranged for ${details.day} ${details.startTime}–${details.endTime} — see it under Sessions.`)
      await load(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const q = search.trim().toLowerCase()
  const searched = q
    ? rows.filter(({ r, other }) => (r.moduleName || '').toLowerCase().includes(q) || (other.name || other.email || '').toLowerCase().includes(q))
    : rows

  const pending = searched.filter(({ r }) => r.status === 'pending')
  const accepted = searched.filter(({ r, session }) => r.status === 'accepted' && (!session || session.status === 'arranged' || session.status === 'cancelled'))
  const completed = searched.filter(({ r, session }) => r.status === 'accepted' && session?.status === 'completed')
  const declined = searched.filter(({ r }) => r.status === 'rejected')

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">REQUESTS</p>
          <h1>Tutoring requests</h1>
          <p className="sub">Respond to requests, arrange sessions once accepted, and track how each one turned out.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="info">{success}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <p>
            Nothing here yet. Head to <Link to="/find-tutors">Find Tutors</Link> to send a request, or wait for someone to request tutoring from you.
          </p>
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
              <p>No requests match "{search}".</p>
            </div>
          )}
          <div className="req-groups">
          <Group title="Pending" icon="inbox" rows={pending}>
            {({ r, role }) => (
              <div className="request-actions">
                {role === 'tutor' ? (
                  <>
                    <button disabled={busyId === r.matchId} onClick={() => respond(r.matchId, 'accepted')}>Accept</button>
                    <button className="outline" disabled={busyId === r.matchId} onClick={() => respond(r.matchId, 'rejected')}>Decline</button>
                  </>
                ) : (
                  <>
                    <span className="status-badge pending">Awaiting response</span>
                    <button className="outline" disabled={busyId === r.matchId} onClick={() => respond(r.matchId, 'rejected', 'Request cancelled.')}>Cancel</button>
                  </>
                )}
              </div>
            )}
          </Group>

          <Group
            title="Accepted"
            icon="check"
            rows={accepted}
            renderBelow={({ r, session }) =>
              (session?.status === 'cancelled' || arrangingId === r.matchId) && (
                <ArrangeForm
                  matchId={r.matchId}
                  busy={busyId === r.matchId}
                  onArrange={arrange}
                  onCancel={session?.status === 'cancelled' ? undefined : () => setArrangingId(null)}
                  relabel={session?.status === 'cancelled' ? 'Re-arrange session' : undefined}
                />
              )
            }
          >
            {({ r, session }) => {
              if (session?.status === 'arranged') {
                return (
                  <div className="request-actions">
                    <Link className="view-tutors" to="/sessions">
                      Arranged for {session.day} {session.startTime}–{session.endTime} <Icon name="chevron" size={14} />
                    </Link>
                  </div>
                )
              }
              if (session?.status === 'cancelled') return <span className="status-badge cancelled">Session cancelled</span>
              if (arrangingId === r.matchId) {
                return (
                  <button className="outline" disabled={busyId === r.matchId} onClick={() => setArrangingId(null)}>Close</button>
                )
              }
              return (
                <div className="request-actions">
                  <button disabled={busyId === r.matchId} onClick={() => setArrangingId(r.matchId)}>Arrange session</button>
                </div>
              )
            }}
          </Group>

          <Group title="Completed" icon="star" rows={completed} collapsedByDefault>
            {() => <span className="status-badge completed">Completed</span>}
          </Group>

          <Group title="Declined" icon="x" rows={declined} collapsedByDefault>
            {() => <span className="status-badge declined">Declined</span>}
          </Group>
          </div>
        </>
      )}
    </>
  )

  function Group({ title, icon, rows, children, renderBelow, collapsedByDefault }) {
    const [open, setOpen] = useState(!collapsedByDefault)
    if (!rows.length) return null
    return (
      <div className="requests">
        <div className="section-heading">
          <h2><Icon name={icon} size={16} /> {title}</h2>
          <span className="count">{rows.length}</span>
        </div>
        {open ? (
          rows.map(({ r, role, other, session, topics }) => (
            <div className="request-card" key={r.matchId}>
              <div className="request-mini">
                <div className="request-who">
                  <Avatar name={other?.name || other?.email} id={other?.userId} small />
                  <div>
                    <b>{r.moduleName}</b>
                    <small>{role === 'tutor' ? 'From' : 'To'} {other.name || other.email} · Requested {formatRequestedAt(r.createdAt)}</small>
                  </div>
                </div>
                <div className="request-meta">
                  {r.score != null && (
                    <span className={'score-pill sm ' + scoreBand(r.score)}>
                      <b>{r.score}%</b>
                    </span>
                  )}
                  {children({ r, other, role, session })}
                </div>
              </div>
              {topics.length > 0 && (
                <div className="chips request-topics">
                  {topics.map((t) => <span key={t}>{t}</span>)}
                </div>
              )}
              {session?.status === 'cancelled' && (
                <p className="recommend-copy cancelled-note">
                  <Icon name="x" size={12} /> The arranged session was cancelled — {session.day} {session.startTime}–{session.endTime}.
                </p>
              )}
              {renderBelow && renderBelow({ r, other, role, session })}
            </div>
          ))
        ) : (
          <button className="view-tutors" onClick={() => setOpen(true)}>
            Show {rows.length} <Icon name="chevron" size={14} />
          </button>
        )}
      </div>
    )
  }
}

function ArrangeForm({ matchId, busy, onArrange, onCancel, relabel }) {
  const [day, setDay] = useState('Mon')
  const [startTime, setStartTime] = useState('14:00')
  const [endTime, setEndTime] = useState('15:00')
  const [format, setFormat] = useState('in-person')
  const [location, setLocation] = useState('')

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
            placeholder={format === 'online' ? 'A Zoom link is created automatically' : 'e.g. Campus library'}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
      </div>
      {format === 'online' && (
        <p className="recommend-copy arrange-zoom-hint">
          A real Zoom meeting is created automatically once confirmed — no need to paste a link.
        </p>
      )}
      <div className="arrange-actions">
        {onCancel && <button className="outline" disabled={busy} onClick={onCancel}>Cancel</button>}
        <button
          disabled={busy || endTime <= startTime}
          onClick={() => onArrange(matchId, { day, startTime, endTime, format, location: location || (format === 'online' ? 'Online' : 'Campus library') })}
        >
          {relabel || 'Confirm session'}
        </button>
      </div>
    </div>
  )
}
