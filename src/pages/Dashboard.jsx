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
  listAllLearningRequests,
  listAllTeachingSubjects,
  listMatchRequests,
  listUsers,
} from '../lib/firestore.js'

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [recommended, setRecommended] = useState([])
  const [nextSession, setNextSession] = useState(null)
  const [pending, setPending] = useState([])
  const [stats, setStats] = useState({ completed: 0, modulesLearning: 0, tutoring: 0 })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const [users, matchRequests, teachingSubjects, myTeaching, myRequests] = await Promise.all([
          listUsers(),
          listMatchRequests(user.userId),
          listAllTeachingSubjects(),
          getTeachingSubjects(user.userId),
          listAllLearningRequests(),
        ])
        if (cancelled) return

        const usersById = Object.fromEntries(users.map((u) => [u.userId, u]))
        const allMatchIds = [...matchRequests.incoming, ...matchRequests.outgoing].map((r) => r.matchId)
        const sessions = allMatchIds.length ? await getSessionsByMatchIds(allMatchIds) : []
        if (cancelled) return

        const upcoming = sessions
          .filter((s) => s.status === 'arranged')
          .sort((a, b) => (a.day + a.startTime).localeCompare(b.day + b.startTime))[0]

        const pendingRows = [...matchRequests.incoming, ...matchRequests.outgoing]
          .filter((r) => r.status === 'pending')
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          .slice(0, 3)
          .map((r) => {
            const role = matchRequests.incoming.includes(r) ? 'tutor' : 'student'
            return { ...r, role, other: usersById[role === 'tutor' ? r.studentId : r.tutorId] }
          })

        const tutorIds = new Set(teachingSubjects.map((s) => s.userId))
        tutorIds.delete(user.userId)
        const recommendedTutors = [...tutorIds]
          .map((id) => ({
            tutor: usersById[id],
            subjects: teachingSubjects.filter((s) => s.userId === id),
          }))
          .filter((r) => r.tutor)
          .slice(0, 3)

        const completedCount = sessions.filter((s) => s.status === 'completed').length
        const modulesLearning = new Set(myRequests.filter((r) => r.userId === user.userId).map((r) => r.moduleId)).size

        setRecommended(recommendedTutors)
        setNextSession(upcoming || null)
        setPending(pendingRows)
        setStats({ completed: completedCount, modulesLearning, tutoring: myTeaching.length })
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
      <section className="hero-panel">
        <div className="hero-text">
          <p className="eyebrow">{today.toUpperCase()}</p>
          <h1>
            Hi {firstName} <span>👋</span>
          </h1>
          <p className="sub">What would you like to do today?</p>
        </div>
        <div className="hero-actions">
          <button className="match-btn" onClick={() => navigate('/find-tutors')}>
            <span><Icon name="search" size={15} /></span>
            Find a Tutor
          </button>
          <button className="hero-secondary" onClick={() => navigate('/profile#teaching')}>
            <Icon name="plus" size={15} />
            Offer Tutoring
          </button>
        </div>
      </section>

      {loadError && <Banner kind="error">{loadError}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <div className="stat-icon done"><Icon name="check" size={17} /></div>
              <div>
                <b>{stats.completed}</b>
                <span>Sessions completed</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon learn"><Icon name="book" size={17} /></div>
              <div>
                <b>{stats.modulesLearning}</b>
                <span>Modules you're learning</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon teach"><Icon name="spark" size={17} /></div>
              <div>
                <b>{stats.tutoring}</b>
                <span>Modules you teach</span>
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
                  <div className="empty-state compact">
                    <span className="empty-icon">📅</span>
                    <p>No upcoming sessions yet. Once a request is accepted and arranged, it'll show up here.</p>
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
                  <div className="empty-state compact">
                    <span className="empty-icon">✅</span>
                    <p>Nothing pending. You're all caught up.</p>
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
                    <h2>Tutors on NYPkaki</h2>
                  </div>
                  <Link to="/find-tutors" className="view-tutors">Find more <Icon name="chevron" size={14} /></Link>
                </div>

                {recommended.length === 0 ? (
                  <div className="empty-state compact">
                    <span className="empty-icon">🎓</span>
                    <p>No one's set up a tutor profile yet. Be the first — tap Offer Tutoring above.</p>
                  </div>
                ) : (
                  <div className="tutor-grid two-col">
                    {recommended.map(({ tutor, subjects }) => (
                      <article className="tutor-card" key={tutor.userId}>
                        <div className="tutor-top">
                          <Avatar name={tutor.name || tutor.email} id={tutor.userId} />
                        </div>
                        <div className="tutor-name">
                          <h3>{tutor.name || 'A NYPkaki student'}</h3>
                        </div>
                        <p className="course">
                          {tutor.course || 'Course not set yet'} {tutor.year && <><b>•</b> Year {tutor.year}</>}
                        </p>
                        <div className="chips">
                          {subjects.slice(0, 3).map((s) => (
                            <span key={s.moduleId}>{s.moduleName}</span>
                          ))}
                        </div>
                        <button className="card-btn" onClick={() => navigate('/find-tutors')}>
                          Request tutoring <Icon name="arrow" size={16} />
                        </button>
                      </article>
                    ))}
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
