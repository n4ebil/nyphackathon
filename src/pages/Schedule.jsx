import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { Icon } from '../components/Icon.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import {
  createClassSession,
  deleteClassSession,
  listAllClassInterests,
  listClassSessions,
  registerInterest,
  unregisterInterest,
} from '../lib/firestore.js'

const LT_ROOMS = ['LT-01', 'LT-02', 'LT-03']
const CLASSROOMS = ['L501', 'L502', 'L503', 'L504', 'L505', 'L601', 'L602', 'L603', 'L604', 'L605']

function formatDate(iso) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function Schedule() {
  const { user } = useAuth()
  const [classes, setClasses] = useState([])
  const [interests, setInterests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [creating, setCreating] = useState(false)

  const [form, setForm] = useState({
    title: '',
    date: '',
    startTime: '14:00',
    endTime: '15:00',
    location: LT_ROOMS[0],
    notes: '',
  })

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [sessions, allInterests] = await Promise.all([listClassSessions(), listAllClassInterests()])
      sessions.sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
      setClasses(sessions)
      setInterests(allInterests)
    } catch (err) {
      setError(err.message || 'Could not load the schedule.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function onCreate(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.date) return
    setCreating(true)
    setError('')
    try {
      await createClassSession({
        teacherId: user.userId,
        teacherName: user.name || user.email,
        title: form.title.trim(),
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        location: form.location,
        notes: form.notes.trim(),
      })
      setForm((f) => ({ ...f, title: '', date: '', notes: '' }))
      await load()
    } catch (err) {
      setError(err.message || 'Could not open that class.')
    } finally {
      setCreating(false)
    }
  }

  async function toggleInterest(cls) {
    const already = interests.some((i) => i.classId === cls.classId && i.userId === user.userId)
    setBusyId(cls.classId)
    setError('')
    try {
      if (already) await unregisterInterest(cls.classId, user.userId)
      else await registerInterest(cls.classId, user.userId, user.name || user.email)
      await load()
    } catch (err) {
      setError(err.message || 'Could not update your interest.')
    } finally {
      setBusyId(null)
    }
  }

  async function cancelClass(cls) {
    if (!confirm(`Cancel "${cls.title}"? Everyone who registered interest will lose the listing.`)) return
    setBusyId(cls.classId)
    setError('')
    try {
      await deleteClassSession(cls.classId)
      await load()
    } catch (err) {
      setError(err.message || 'Could not cancel that class.')
    } finally {
      setBusyId(null)
    }
  }

  const interestsFor = (classId) => interests.filter((i) => i.classId === classId)

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">EXTRA CLASSES</p>
          <h1>Schedule</h1>
          <p className="sub">Opening an extra class? Post it here — classmates can register interest.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card">
        <h2>Open a class</h2>
        <form onSubmit={onCreate}>
          <label className="field">
            What's the class about?
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Extra revision for Database Systems"
            />
          </label>

          <div className="form-grid">
            <label className="field">
              Date
              <input type="date" required value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </label>
            <label className="field">
              Time
              <div className="time-range">
                <input type="time" required value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
                <span>–</span>
                <input type="time" required value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              </div>
            </label>
          </div>

          <label className="field">
            Location
            <select value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}>
              <optgroup label="Lecture Theatre">
                {LT_ROOMS.map((room) => (
                  <option key={room} value={room}>
                    {room}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Classroom">
                {CLASSROOMS.map((room) => (
                  <option key={room} value={room}>
                    {room}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="field">
            Notes (optional)
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Anything students should know beforehand" />
          </label>

          <button className="primary" type="submit" disabled={creating}>
            {creating ? <Spinner /> : <>Open this class <Icon name="arrow" size={16} /></>}
          </button>
        </form>
      </div>

      <section className="find-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{loading ? '…' : classes.length} UPCOMING</p>
            <h2>Open classes</h2>
          </div>
        </div>

        {loading ? (
          <AppLoader compact />
        ) : classes.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📚</span>
            <p>No extra classes open yet. Be the first to schedule one above.</p>
          </div>
        ) : (
          <div className="match-list">
            {classes.map((cls) => {
              const attendees = interestsFor(cls.classId)
              const isTeacher = cls.teacherId === user.userId
              const isIn = attendees.some((a) => a.userId === user.userId)
              const busy = busyId === cls.classId

              return (
                <article className="match-card" key={cls.classId}>
                  <div className="match-card-top">
                    <Avatar name={cls.teacherName} id={cls.teacherId} />
                    <div className="match-card-info">
                      <h3>{cls.title}</h3>
                      <p className="course">
                        {cls.teacherName} <b>•</b> {formatDate(cls.date)} · {cls.startTime}–{cls.endTime}
                      </p>
                    </div>
                    <span className="location-badge">{cls.location}</span>
                  </div>

                  {cls.notes && <p className="explanation">{cls.notes}</p>}

                  {attendees.length > 0 && (
                    <div className="chips">
                      {attendees.map((a) => (
                        <span key={a.userId}>{a.userName}</span>
                      ))}
                    </div>
                  )}

                  <div className="match-card-actions">
                    <span className="view-tutors">
                      {attendees.length} interested
                    </span>
                    {isTeacher ? (
                      <button className="card-btn inline danger-btn" onClick={() => cancelClass(cls)} disabled={busy}>
                        {busy ? <Spinner /> : 'Cancel class'}
                      </button>
                    ) : (
                      <button className={'card-btn inline' + (isIn ? ' sent' : '')} onClick={() => toggleInterest(cls)} disabled={busy}>
                        {busy ? <Spinner /> : isIn ? (
                          <>
                            <Icon name="check" size={14} /> You're in
                          </>
                        ) : (
                          "I'm interested"
                        )}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
