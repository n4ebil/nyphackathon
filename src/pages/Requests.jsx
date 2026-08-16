import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { arrangeSession, getSessionsByMatchIds, listMatchRequests, respondToMatchRequest } from '../lib/firestore.js'

export function Requests() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [sessions, setSessions] = useState([])
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await listMatchRequests(user.userId)
      const matchIds = [...result.incoming, ...result.outgoing].map((r) => r.matchId)
      const arranged = matchIds.length ? await getSessionsByMatchIds(matchIds) : []
      setIncoming(result.incoming)
      setOutgoing(result.outgoing)
      setSessions(arranged)
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

  const sessionFor = (matchId) => sessions.find((s) => s.matchId === matchId)

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">MY SESSIONS</p>
          <h1>Requests &amp; sessions</h1>
          <p className="sub">Everything you've sent and received.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading ? (
        <div className="app-loading small">
          <Spinner />
        </div>
      ) : (
        <div className="summary">
          <div className="requests">
            <div className="section-heading">
              <h2>Requests received</h2>
              {incoming.length > 0 && <span className="count">{incoming.length}</span>}
            </div>
            {incoming.length === 0 ? (
              <p className="recommend-copy">No one has requested tutoring from you yet.</p>
            ) : (
              incoming.map((r) => (
                <RequestRow key={r.matchId} r={r} session={sessionFor(r.matchId)} busy={busyId === r.matchId}>
                  {r.status === 'pending' && (
                    <>
                      <button disabled={busyId === r.matchId} onClick={() => respond(r.matchId, 'accepted')}>
                        Accept
                      </button>
                      <button className="outline" disabled={busyId === r.matchId} onClick={() => respond(r.matchId, 'rejected')}>
                        Decline
                      </button>
                    </>
                  )}
                  {r.status === 'accepted' && !sessionFor(r.matchId) && (
                    <button disabled={busyId === r.matchId} onClick={() => arrange(r.matchId)}>
                      Arrange session
                    </button>
                  )}
                </RequestRow>
              ))
            )}
          </div>

          <div className="requests">
            <div className="section-heading">
              <h2>Requests you sent</h2>
              {outgoing.length > 0 && <span className="count">{outgoing.length}</span>}
            </div>
            {outgoing.length === 0 ? (
              <p className="recommend-copy">
                You haven't requested tutoring yet. Head to your <Link to="/dashboard">Dashboard</Link> to find a tutor.
              </p>
            ) : (
              outgoing.map((r) => (
                <RequestRow key={r.matchId} r={r} session={sessionFor(r.matchId)} busy={busyId === r.matchId} />
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}

function RequestRow({ r, session, children }) {
  return (
    <div className="request-mini">
      <div>
        <b>{r.moduleName}</b>
        <small>
          Status: {r.status}
          {session ? ` · ${session.day} ${session.startTime}–${session.endTime} · ${session.location}` : ''}
        </small>
      </div>
      {children}
    </div>
  )
}
