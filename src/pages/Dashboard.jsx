import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { Icon } from '../components/Icon.jsx'
import { Banner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import {
  getSessionsByMatchIds,
  getTeachingSubjects,
  listAllAvailability,
  listAllLearningRequests,
  listMatchRequests,
  listUsers,
} from '../lib/firestore.js'
import { computeRecommendedTutors } from '../lib/match.js'

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FORMAT_META = {
  online: ['💻', 'Online'],
  'in-person': ['📍', 'In-person'],
  either: ['🔀', 'Flexible'],
}
function bestSlot(slots) {
  if (!slots.length) return null
  return [...slots].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))[0]
}

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [recommended, setRecommended] = useState([])
  const [availabilityByTutor, setAvailabilityByTutor] = useState({})
  const [nextSession, setNextSession] = useState(null)
  const [pending, setPending] = useState([])
  const [stats, setStats] = useState({ completed: 0, modulesLearning: 0, tutoring: 0, upcoming: 0 })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const [users, matchRequests, myTeaching, myRequests, availability, recommendedTutors] = await Promise.all([
          listUsers(),
          listMatchRequests(user.userId),
          getTeachingSubjects(user.userId),
          listAllLearningRequests(),
          listAllAvailability(),
          computeRecommendedTutors(user, { limit: 3 }),
        ])
        if (cancelled) return

        const usersById = Object.fromEntries(users.map((u) => [u.userId, u]))
        const allMatchIds = [...matchRequests.incoming, ...matchRequests.outgoing].map((r) => r.matchId)
        const sessions = allMatchIds.length ? await getSessionsByMatchIds(allMatchIds) : []
        if (cancelled) return

        const arranged = sessions.filter((s) => s.status === 'arranged')
        const upcoming = [...arranged].sort((a, b) => (a.day + a.startTime).localeCompare(b.day + b.startTime))[0]

        const pendingRows = [...matchRequests.incoming, ...matchRequests.outgoing]
          .filter((r) => r.status === 'pending')
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          .slice(0, 3)
          .map((r) => {
            const role = matchRequests.incoming.includes(r) ? 'tutor' : 'student'
            return { ...r, role, other: usersById[role === 'tutor' ? r.studentId : r.tutorId] }
          })

        const slotsByTutor = {}
        for (const m of recommendedTutors) {
          slotsByTutor[m.tutorId] = availability.filter((a) => a.userId === m.tutorId)
        }

        const completedCount = sessions.filter((s) => s.status === 'completed').length
        const modulesLearning = new Set(myRequests.filter((r) => r.userId === user.userId).map((r) => r.moduleId)).size

        setRecommended(recommendedTutors)
        setAvailabilityByTutor(slotsByTutor)
        setNextSession(upcoming || null)
        setPending(pendingRows)
        setStats({ completed: completedCount, modulesLearning, tutoring: myTeaching.length, upcoming: arranged.length })
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Could not load your dashboard.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user.userId])

  const today = new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName = (user.name || user.email || '').split(' ')[0]

  return (
    <>
      <section className="dash-hero">
        <div className="dash-hero-text">
          <p className="eyebrow">WELCOME BACK, {firstName.toUpperCase()}</p>
          <h1>Find the right peer to learn with.</h1>
          <p className="sub">Tell us what you're struggling with and we'll find students who can help.</p>
        </div>
        <div className="dash-hero-actions">
          <button className="dash-cta-primary" onClick={() => navigate('/find-tutors')}>
            ✨ Tell us what you need
          </button>
          <button className="dash-cta-secondary" onClick={() => navigate('/find-tutors')}>
            Browse Tutors
          </button>
        </div>
      </section>

      {loadError && <Banner kind="error">{loadError}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : (
        <>
          <div className="dash-stats">
            <div className="dash-stat">
              <div className="dash-stat-icon done"><Icon name="check" size={16} /></div>
              <div>
                <b>{stats.completed}</b>
                <span>Sessions completed</span>
              </div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-icon learn"><Icon name="book" size={16} /></div>
              <div>
                <b>{stats.modulesLearning}</b>
                <span>Modules learning</span>
              </div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-icon teach"><Icon name="spark" size={16} /></div>
              <div>
                <b>{stats.tutoring}</b>
                <span>Modules you teach</span>
              </div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-icon upcoming"><Icon name="clock" size={16} /></div>
              <div>
                <b>{stats.upcoming}</b>
                <span>Upcoming sessions</span>
              </div>
            </div>
          </div>

          <div className="dash-grid">
            <div className="dash-col">
              <section className="find-section tight">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">UP NEXT</p>
                    <h2>Your session</h2>
                  </div>
                </div>
                {nextSession ? (
                  <div className="upcoming-hero card">
                    <div className="upcoming-hero-badge">
                      <Icon name="clock" size={16} />
                    </div>
                    <div className="upcoming-hero-body">
                      <b>{nextSession.day} · {nextSession.startTime}–{nextSession.endTime}</b>
                      <p className="recommend-copy">
                        <Icon name="location" size={12} /> {nextSession.location} · {nextSession.format}
                      </p>
                    </div>
                    <button className="join" onClick={() => navigate('/sessions')}>
                      View <Icon name="arrow" size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="dash-empty">
                    <div className="dash-empty-icon"><Icon name="calendar" size={19} /></div>
                    <div className="dash-empty-body">
                      <b>No sessions scheduled yet</b>
                      <p>Once a tutor accepts your request and you arrange a time, it'll show up here.</p>
                    </div>
                    <button className="dash-outline-btn" onClick={() => navigate('/find-tutors')}>Find a tutor</button>
                  </div>
                )}
              </section>

              <section className="find-section tight">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">NEEDS ATTENTION</p>
                    <h2>Pending requests</h2>
                  </div>
                  {pending.length > 0 && <Link to="/requests" className="view-tutors">View all <Icon name="chevron" size={14} /></Link>}
                </div>
                {pending.length === 0 ? (
                  <div className="dash-empty">
                    <div className="dash-empty-icon success"><Icon name="check" size={19} /></div>
                    <div className="dash-empty-body">
                      <b>You're all caught up</b>
                      <p>Nothing waiting on a response right now.</p>
                    </div>
                  </div>
                ) : (
                  <div className="pending-list">
                    {pending.map((r) => (
                      <div className="pending-row" key={r.matchId}>
                        <Avatar name={r.other?.name || r.other?.email} id={r.other?.userId} small />
                        <div>
                          <b>{r.moduleName}</b>
                          <span>{r.role === 'tutor' ? 'Requested by' : 'Sent to'} {r.other?.name || 'a classmate'}</span>
                        </div>
                        <span className="badge-pending">Pending</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="dash-col">
              <section className="find-section tight">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">RECOMMENDED FOR YOU</p>
                    <h2>Tutors who fit your needs</h2>
                  </div>
                  <Link to="/find-tutors" className="view-tutors">Find more <Icon name="chevron" size={14} /></Link>
                </div>

                {recommended.length === 0 ? (
                  <div className="dash-empty">
                    <div className="dash-empty-icon"><Icon name="spark" size={19} /></div>
                    <div className="dash-empty-body">
                      <b>No tutors to recommend yet</b>
                      <p>No one's set up a tutor profile for your modules yet — check back soon.</p>
                    </div>
                  </div>
                ) : (
                  <div className="reco-list">
                    {recommended.map((m) => {
                      const stats = m.tutorStats
                      const slot = bestSlot(availabilityByTutor[m.tutorId] || [])
                      const [formatIcon, formatLabel] = FORMAT_META[m.tutor.preferredFormat] || FORMAT_META.either
                      const band = m.score >= 80 ? 'excellent' : m.score >= 60 ? 'good' : m.score >= 40 ? 'possible' : 'low'
                      return (
                        <article className="reco-card" key={m.matchId}>
                          <div className="reco-top">
                            <Avatar name={m.tutor.name || m.tutor.email} id={m.tutorId} small />
                            <div className="reco-top-info">
                              <h3>{m.tutor.name || 'A NYPkaki student'}</h3>
                              <p className="course">{m.moduleName}</p>
                            </div>
                            <div className={'reco-score ' + band}>
                              <b>{m.score}%</b>
                              <span>Match</span>
                            </div>
                          </div>
                          {m.coveredTopics.length > 0 && (
                            <p className="reco-topics">{m.coveredTopics.slice(0, 4).join(' • ')}</p>
                          )}
                          <p className="reco-meta">
                            ⭐ {stats && !stats.isNew && stats.avgRating != null ? <b>{stats.avgRating}</b> : 'New tutor'}
                            {stats && !stats.isNew && stats.avgRating != null && ` · ${stats.sessionsCompleted} session${stats.sessionsCompleted === 1 ? '' : 's'}`}
                            {' · '}🕐 {slot ? `${slot.day} ${slot.startTime}–${slot.endTime}` : 'no availability yet'}
                            {' · '}{formatIcon} {formatLabel}
                          </p>
                          <button className="dash-outline-btn wide" onClick={() => navigate('/find-tutors')}>View Profile</button>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </>
  )
}
