import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { Icon } from '../components/Icon.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import {
  deleteClassRequest,
  listAllClassInterests,
  listAllTeachingSubjects,
  listClassRequests,
  listUsers,
  registerInterest,
  scheduleClassRequest,
  unregisterInterest,
} from '../lib/firestore.js'
import { submitClassRequest } from '../lib/match.js'

const LT_ROOMS = ['LT-01', 'LT-02', 'LT-03']
const CLASSROOMS = ['L501', 'L502', 'L503', 'L504', 'L505', 'L601', 'L602', 'L603', 'L604', 'L605']
const MIN_INTEREST = 3
// Past this many interested, the class outgrows a classroom and gets bumped to a lecture theatre.
const LT_THRESHOLD = 15

function autoLocation(interestCount) {
  return interestCount > LT_THRESHOLD ? LT_ROOMS[0] : CLASSROOMS[0]
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function Schedule() {
  const { user } = useAuth()
  const [requests, setRequests] = useState([])
  const [interests, setInterests] = useState([])
  const [teachingSubjects, setTeachingSubjects] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState(null)

  const [text, setText] = useState('')
  const [requesting, setRequesting] = useState(false)

  const [schedulingId, setSchedulingId] = useState(null)
  const [scheduleForm, setScheduleForm] = useState({ date: '', startTime: '14:00', endTime: '15:00' })
  const [scheduling, setScheduling] = useState(false)

  // silent=true on action-triggered refreshes so the list doesn't unmount behind the
  // full-page spinner — that was collapsing the page and resetting scroll right after
  // clicking Interested/Cancel/Confirm, with nothing telling you what had just happened.
  async function load(silent) {
    if (!silent) setLoading(true)
    setError('')
    try {
      const [reqs, allInterests, subjects, allUsers] = await Promise.all([
        listClassRequests(),
        listAllClassInterests(),
        listAllTeachingSubjects(),
        listUsers(),
      ])
      const countFor = (id) => allInterests.filter((i) => i.requestId === id).length
      reqs.sort((a, b) => {
        if ((a.status === 'scheduled') !== (b.status === 'scheduled')) return a.status === 'scheduled' ? 1 : -1
        return countFor(b.requestId) - countFor(a.requestId)
      })
      setRequests(reqs)
      setInterests(allInterests)
      setTeachingSubjects(subjects)
      setUsers(allUsers)
    } catch (err) {
      setError(err.message || 'Could not load the schedule.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
  }, [])

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(''), 5000)
    return () => clearTimeout(t)
  }, [success])

  async function onRequest(e) {
    e.preventDefault()
    if (!text.trim()) return
    setRequesting(true)
    setError('')
    try {
      const saved = await submitClassRequest(user, text.trim())
      await registerInterest(saved.requestId, user.userId, user.name || user.email)
      setText('')
      setSuccess('Request posted — it now shows in Open requests below.')
      await load(true)
    } catch (err) {
      setError(err.message || 'Could not submit that request.')
    } finally {
      setRequesting(false)
    }
  }

  async function toggleInterest(req) {
    const already = interests.some((i) => i.requestId === req.requestId && i.userId === user.userId)
    setBusyId(req.requestId)
    setError('')
    try {
      if (already) await unregisterInterest(req.requestId, user.userId)
      else await registerInterest(req.requestId, user.userId, user.name || user.email)
      setSuccess(already ? "You're no longer marked as interested." : "You're in — marked as interested.")
      await load(true)
    } catch (err) {
      setError(err.message || 'Could not update your interest.')
    } finally {
      setBusyId(null)
    }
  }

  async function cancelRequest(req) {
    if (!confirm('Cancel this request? Everyone interested will lose the listing.')) return
    setBusyId(req.requestId)
    setError('')
    try {
      await deleteClassRequest(req.requestId)
      setSuccess('Request cancelled.')
      await load(true)
    } catch (err) {
      setError(err.message || 'Could not cancel that request.')
    } finally {
      setBusyId(null)
    }
  }

  function startScheduling(req) {
    setSchedulingId(req.requestId)
    setScheduleForm({ date: '', startTime: '14:00', endTime: '15:00' })
  }

  async function confirmSchedule(req) {
    if (!scheduleForm.date) {
      setError('Pick a date first.')
      return
    }
    setScheduling(true)
    setError('')
    try {
      const interestCount = interestsFor(req.requestId).length
      await scheduleClassRequest(req.requestId, {
        teacherId: user.userId,
        teacherName: user.name || user.email,
        date: scheduleForm.date,
        startTime: scheduleForm.startTime,
        endTime: scheduleForm.endTime,
        location: autoLocation(interestCount),
      })
      setSchedulingId(null)
      setSuccess(`Class confirmed for ${formatDate(scheduleForm.date)} — moved to scheduled.`)
      await load(true)
    } catch (err) {
      setError(err.message || 'Could not schedule that class.')
    } finally {
      setScheduling(false)
    }
  }

  const interestsFor = (requestId) => interests.filter((i) => i.requestId === requestId)
  // A teachingSubjects record can outlive the account that created it (e.g. admin
  // cleanup deletes the user but not their subjects) — drop those instead of
  // showing a tutor who no longer exists.
  const tutorsFor = (moduleId) =>
    teachingSubjects
      .filter((s) => s.moduleId === moduleId)
      .map((s) => ({ ...s, tutor: users.find((u) => u.userId === s.userId) }))
      .filter((s) => s.tutor)
      .map((s) => ({ ...s, name: s.tutor.name || s.tutor.email }))
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">EXTRA CLASSES</p>
          <h1>Schedule</h1>
          <p className="sub">
            Request help with a module — once {MIN_INTEREST}+ classmates pile on, it's surfaced to tutors who teach it.
          </p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="info">{success}</Banner>}

      <div className="card find-form">
        <h2>Request a class</h2>
        <form onSubmit={onRequest}>
          <label className="field">
            What do you need help with?
            <textarea
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. I keep mixing up LEFT and INNER joins before my test"
            />
          </label>
          <button className="primary" type="submit" disabled={requesting}>
            {requesting ? <Spinner /> : <>Request help <Icon name="arrow" size={16} /></>}
          </button>
        </form>
      </div>

      <section className="find-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{loading ? '…' : requests.length} REQUESTS</p>
            <h2>Open requests</h2>
          </div>
        </div>

        {loading ? (
          <AppLoader compact />
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📚</span>
            <p>No requests yet. Be the first to ask for help above.</p>
          </div>
        ) : (
          <div className="match-list">
            {requests.map((req) => {
              const attendees = interestsFor(req.requestId)
              const isIn = attendees.some((a) => a.userId === user.userId)
              const isScheduled = req.status === 'scheduled'
              const isCreator = req.studentId === user.userId
              const isAssignedTeacher = isScheduled && req.teacherId === user.userId
              const busy = busyId === req.requestId
              const isScheduling = schedulingId === req.requestId
              const readyForTutor = !isScheduled && attendees.length >= MIN_INTEREST
              const matchedTutors = readyForTutor ? tutorsFor(req.moduleId) : []
              const iAmMatchedTutor = matchedTutors.some((t) => t.userId === user.userId)

              return (
                <article className="match-card" key={req.requestId}>
                  <div className="match-card-top">
                    <Avatar name={req.studentName} id={req.studentId} />
                    <div className="match-card-info">
                      <h3>{req.moduleName}</h3>
                      <p className="course">Requested by {req.studentName}</p>
                    </div>
                    {req.status === 'scheduled' ? (
                      <span className="location-badge">{req.location}</span>
                    ) : (
                      <span className={'parse-tag' + (readyForTutor ? ' ai' : '')}>
                        {attendees.length}/{MIN_INTEREST} interested
                      </span>
                    )}
                  </div>

                  <p className="explanation">{req.description}</p>

                  {req.topics?.length > 0 && (
                    <div className="chips">
                      {req.topics.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  )}

                  {req.status === 'scheduled' ? (
                    <Banner kind="info">
                      <b>{req.teacherName}</b> is teaching this {formatDate(req.date)} · {req.startTime}–{req.endTime} at{' '}
                      <b>{req.location}</b>.
                    </Banner>
                  ) : readyForTutor ? (
                    <Banner kind="info">
                      🎯 Enough interest — surfaced to tutors who teach {req.moduleName}
                      {matchedTutors.length ? `: ${matchedTutors.map((t) => t.name).join(', ')}.` : ', but no one has listed it yet.'}
                    </Banner>
                  ) : null}

                  {attendees.length > 0 && (
                    <div className="chips">
                      {attendees.slice(0, 6).map((a) => (
                        <span key={a.userId}>{a.userName}</span>
                      ))}
                      {attendees.length > 6 && <span>+{attendees.length - 6} more</span>}
                    </div>
                  )}

                  {isScheduling ? (
                    <div className="breakdown">
                      <div className="form-grid">
                        <label className="field">
                          Date
                          <input
                            type="date"
                            required
                            value={scheduleForm.date}
                            onChange={(e) => setScheduleForm((f) => ({ ...f, date: e.target.value }))}
                          />
                        </label>
                        <label className="field">
                          Time
                          <div className="time-range">
                            <input
                              type="time"
                              value={scheduleForm.startTime}
                              onChange={(e) => setScheduleForm((f) => ({ ...f, startTime: e.target.value }))}
                            />
                            <span>–</span>
                            <input
                              type="time"
                              value={scheduleForm.endTime}
                              onChange={(e) => setScheduleForm((f) => ({ ...f, endTime: e.target.value }))}
                            />
                          </div>
                        </label>
                      </div>
                      <p className="recommend-copy">
                        Room auto-assigned by headcount: <b>{autoLocation(attendees.length)}</b>
                        {attendees.length > LT_THRESHOLD ? ` (${attendees.length} interested, needs a lecture theatre)` : ''}.
                      </p>
                      <div className="match-card-actions">
                        <button className="view-tutors" onClick={() => setSchedulingId(null)} disabled={scheduling}>
                          Cancel
                        </button>
                        <button className="card-btn inline" onClick={() => confirmSchedule(req)} disabled={scheduling}>
                          {scheduling ? <Spinner /> : 'Confirm class'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="match-card-actions">
                      {isAssignedTeacher ? (
                        <span className="sent-tag">
                          <Icon name="check" size={14} /> You're hosting
                        </span>
                      ) : iAmMatchedTutor ? (
                        <button className="card-btn inline" onClick={() => startScheduling(req)}>
                          Host this class
                        </button>
                      ) : isCreator && !isScheduled ? (
                        <button className="card-btn inline danger-btn" onClick={() => cancelRequest(req)} disabled={busy}>
                          {busy ? <Spinner /> : 'Cancel request'}
                        </button>
                      ) : (
                        // Anyone else — including people who missed the window before this hit
                        // the interest threshold or got scheduled — can still join or drop out.
                        <button className={'card-btn inline' + (isIn ? ' sent' : '')} onClick={() => toggleInterest(req)} disabled={busy}>
                          {busy ? (
                            <Spinner />
                          ) : isIn ? (
                            <>
                              <Icon name="check" size={14} /> {isScheduled ? "You're coming" : "You're in"}
                            </>
                          ) : isScheduled ? (
                            "I'm coming"
                          ) : (
                            "I'm interested"
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
