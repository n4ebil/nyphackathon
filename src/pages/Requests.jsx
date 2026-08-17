import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Icon } from '../components/Icon.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { arrangeSession, getSessionsByMatchIds, listMatchRequests, listUsers, respondToMatchRequest } from '../lib/firestore.js'

export function Requests() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
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
      const sessions = matchIds.length ? await getSessionsByMatchIds(matchIds) : []
      const sessionByMatch = Object.fromEntries(sessions.map((s) => [s.matchId, s]))
      const withMeta = combined
        .map(({ r, role }) => ({ r, role, session: sessionByMatch[r.matchId], other: usersById[role === 'tutor' ? r.studentId : r.tutorId] }))
        .filter(({ r, session }) => r.status !== 'accepted' || !session)
      setRows(withMeta)
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
      navigate('/sessions')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const pending = rows.filter(({ r }) => r.status === 'pending')
  const accepted = rows.filter(({ r }) => r.status === 'accepted')
  const declined = rows.filter(({ r }) => r.status === 'rejected')

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">REQUESTS</p>
          <h1>Tutoring requests</h1>
          <p className="sub">Respond to requests, and arrange sessions once they're accepted.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

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
        <div className="req-groups">
          <Group title="Awaiting your response" icon="inbox" rows={pending}>
            {({ r, other, role }) => role === 'tutor' && (
              <div className="request-actions">
                <button disabled={busyId === r.matchId} onClick={() => respond(r.matchId, 'accepted')}>Accept</button>
                <button className="outline" disabled={busyId === r.matchId} onClick={() => respond(r.matchId, 'rejected')}>Decline</button>
              </div>
            )}
          </Group>
          <Group title="Accepted — needs a session" icon="check" rows={accepted}>
            {({ r }) => (
              <div className="request-actions">
                <button disabled={busyId === r.matchId} onClick={() => arrange(r.matchId)}>Arrange session</button>
              </div>
            )}
          </Group>
          <Group title="Declined" icon="x" rows={declined} collapsedByDefault />
        </div>
      )}
    </>
  )

  function Group({ title, icon, rows, children, collapsedByDefault }) {
    const [open, setOpen] = useState(!collapsedByDefault)
    if (!rows.length) return null
    return (
      <div className="requests">
        <div className="section-heading">
          <h2><Icon name={icon} size={16} /> {title}</h2>
          <span className="count">{rows.length}</span>
        </div>
        {open ? (
          rows.map(({ r, role, other }) => (
            <div className="request-card" key={r.matchId}>
              <div className="request-mini">
                <div className="request-who">
                  <Avatar name={other?.name || other?.email} id={other?.userId} small />
                  <div>
                    <b>{r.moduleName}</b>
                    <small>{role === 'tutor' ? 'From' : 'To'} {other?.name || other?.email || 'a NYPkaki student'}</small>
                  </div>
                </div>
                {children({ r, other, role })}
              </div>
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
