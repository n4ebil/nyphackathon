import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { Icon } from '../components/Icon.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { modulesForCourse } from '../shared/nyp.ts'
import { getSessionsByMatchIds, listMatchRequests, listUsers, sendMatchRequest } from '../lib/firestore.js'
import { computeMatches, previewLearningRequest, submitLearningRequest } from '../lib/match.js'

const BAND_LABELS = { excellent: 'Great fit', good: 'Good fit', possible: 'Possible fit', low: 'Not quite' }
const DURATIONS = [30, 45, 60, 90, 120]

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // dashboard content: upcoming session + other students
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [peers, setPeers] = useState([])
  const [nextSession, setNextSession] = useState(null)

  // find-a-tutor search
  const textareaRef = useRef(null)
  const [text, setText] = useState('I need help with SQL joins before my test on Friday.')
  const [busy, setBusy] = useState(false)
  const [matchError, setMatchError] = useState('')
  const [preview, setPreview] = useState(null)
  const [request, setRequest] = useState(null)
  const [matches, setMatches] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [sentIds, setSentIds] = useState(new Set())
  const [waitlisted, setWaitlisted] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const [users, matchRequests] = await Promise.all([listUsers(), listMatchRequests(user.userId)])
        const others = users.filter((u) => u.userId !== user.userId)
        const allMatchIds = [...matchRequests.incoming, ...matchRequests.outgoing].map((r) => r.matchId)
        const sessions = allMatchIds.length ? await getSessionsByMatchIds(allMatchIds) : []
        const upcoming = sessions.find((s) => s.status === 'arranged')
        if (cancelled) return
        setPeers(others.slice(0, 3))
        setNextSession(upcoming || null)
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

  function focusSearch() {
    textareaRef.current?.focus()
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function parseRequest() {
    if (!text.trim()) return
    setBusy(true)
    setMatchError('')
    setMatches(null)
    setWaitlisted(false)
    try {
      const parsed = await previewLearningRequest(user, text.trim())
      setPreview(parsed)
    } catch (err) {
      setMatchError(err.message || 'Could not read that request. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmAndFindMatches() {
    setBusy(true)
    setMatchError('')
    try {
      const savedRequest = await submitLearningRequest(user, text.trim(), preview)
      const results = await computeMatches(user, savedRequest)
      setRequest(savedRequest)
      setMatches(results)
      setPreview(null)
    } catch (err) {
      setMatchError(err.message || 'Could not find matches. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function requestTutoring(match, message) {
    setBusy(true)
    setMatchError('')
    try {
      await sendMatchRequest({
        matchId: match.matchId,
        studentId: user.userId,
        tutorId: match.tutorId,
        moduleName: match.moduleName,
        message,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
      setSentIds((prev) => new Set(prev).add(match.matchId))
      setOpenId(null)
    } catch (err) {
      setMatchError(err.message || 'Could not send that request.')
    } finally {
      setBusy(false)
    }
  }

  const today = new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">{today.toUpperCase()}</p>
          <h1>
            Hi {(user.name || user.email || '').split(' ')[0]} <span>👋</span>
          </h1>
          <p className="sub">What would you like help with today?</p>
        </div>
      </div>

      {matchError && <Banner kind="error">{matchError}</Banner>}

      {!preview && (
        <div className="card find-form">
          <label className="field">
            What do you need help with?
            <textarea ref={textareaRef} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button className="primary" onClick={parseRequest} disabled={busy}>
            {busy ? <Spinner /> : <>Find my matches <Icon name="arrow" size={16} /></>}
          </button>
        </div>
      )}

      {preview && (
        <RequestReview
          preview={preview}
          setPreview={setPreview}
          course={user.course}
          busy={busy}
          onBack={() => setPreview(null)}
          onConfirm={confirmAndFindMatches}
        />
      )}

      {matches && (
        <section className="find-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{matches.length} MATCH{matches.length === 1 ? '' : 'ES'} FOR {request.moduleName.toUpperCase()}</p>
              <h2>{matches.length && matches[0].score < 60 ? 'Closest matches' : 'Ranked by fit'}</h2>
            </div>
            <span className={'parse-tag ' + request.parsedBy}>{request.parsedBy === 'ai' ? 'Parsed with AI' : 'Parsed locally'}</span>
          </div>

          {matches.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">🔍</span>
              <p>No one on NYPkaki teaches {request.moduleName} yet. Your request is saved — we'll notify you the moment someone sets up a tutor profile for it.</p>
              {!waitlisted ? (
                <button className="card-btn inline" onClick={() => setWaitlisted(true)}>
                  Join waitlist <Icon name="check" size={14} />
                </button>
              ) : (
                <span className="sent-tag">
                  <Icon name="check" size={14} /> You're on the waitlist
                </span>
              )}
            </div>
          ) : (
            <>
              {matches[0].score < 60 && (
                <p className="recommend-copy no-exact-note">
                  Nobody's a strong fit for this yet — here's who's closest, ranked by how much they overlap with what you need.
                </p>
              )}
              <div className="match-list">
                {matches.map((m) => (
                  <MatchCard
                    key={m.matchId}
                    match={m}
                    open={openId === m.matchId}
                    sent={sentIds.has(m.matchId)}
                    busy={busy}
                    onToggle={() => setOpenId(openId === m.matchId ? null : m.matchId)}
                    onSend={(message) => requestTutoring(m, message)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {loadError && <Banner kind="error">{loadError}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : (
        <>
          {nextSession && (
            <section className="upcoming simple-session">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">YOUR NEXT SESSION</p>
                  <h2>
                    {nextSession.day} · {nextSession.startTime}–{nextSession.endTime}
                  </h2>
                  <p className="recommend-copy">{nextSession.location}</p>
                </div>
              </div>
              <button className="join" onClick={() => navigate('/requests')}>
                View session <Icon name="arrow" size={15} />
              </button>
            </section>
          )}

          <section className="find-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PEOPLE ON NYPKAKI</p>
                <h2>Classmates ready to help</h2>
                <p className="recommend-copy">Describe what you need above and NYPkaki ranks everyone for you</p>
              </div>
            </div>

            {peers.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">🎓</span>
                <p>No one else has joined NYPkaki yet. Once classmates sign up, they'll show up here.</p>
              </div>
            ) : (
              <div className="tutor-grid">
                {peers.map((p) => (
                  <article className="tutor-card" key={p.userId}>
                    <div className="tutor-top">
                      <Avatar name={p.name || p.email} id={p.userId} />
                    </div>
                    <div className="tutor-name">
                      <h3>{p.name || 'A NYPkaki student'}</h3>
                    </div>
                    <p className="course">
                      {p.course || 'Course not set yet'} {p.year && <><b>•</b> Year {p.year}</>}
                    </p>
                    <p className="recommend-copy">{p.bio}</p>
                    <button className="card-btn" onClick={focusSearch}>
                      Find a match with them <Icon name="arrow" size={16} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

function RequestReview({ preview, setPreview, course, busy, onBack, onConfirm }) {
  const [topicInput, setTopicInput] = useState('')
  const courseModules = modulesForCourse(course)
  const options = courseModules.some((m) => m.moduleId === preview.moduleId)
    ? courseModules
    : [{ moduleId: preview.moduleId, moduleName: preview.moduleName, topics: [] }, ...courseModules]

  function set(field, value) {
    setPreview((p) => ({ ...p, [field]: value }))
  }

  function addTopic() {
    const t = topicInput.trim()
    if (!t || preview.topics.includes(t)) return
    set('topics', [...preview.topics, t])
    setTopicInput('')
  }

  function removeTopic(t) {
    set('topics', preview.topics.filter((x) => x !== t))
  }

  return (
    <div className="card find-form review-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">REVIEW YOUR REQUEST</p>
          <h2>Did we get this right?</h2>
        </div>
      </div>
      <p className="recommend-copy">"{preview.description}"</p>

      <div className="review-grid">
        <label className="field">
          Competency
          <select value={preview.moduleId} onChange={(e) => {
            const m = options.find((o) => o.moduleId === e.target.value)
            setPreview((p) => ({ ...p, moduleId: m.moduleId, moduleName: m.moduleName }))
          }}>
            {options.map((m) => (
              <option key={m.moduleId} value={m.moduleId}>{m.moduleName}</option>
            ))}
          </select>
        </label>

        <label className="field">
          Urgency
          <select value={preview.urgency} onChange={(e) => set('urgency', e.target.value)}>
            <option value="low">Low — whenever works</option>
            <option value="medium">Medium — sometime soon</option>
            <option value="high">High — got a deadline coming up</option>
          </select>
        </label>

        <label className="field">
          Deadline (optional)
          <input type="date" value={preview.deadline || ''} onChange={(e) => set('deadline', e.target.value || null)} />
        </label>

        <label className="field">
          Format
          <select value={preview.preferredFormat} onChange={(e) => set('preferredFormat', e.target.value)}>
            <option value="in-person">In-person</option>
            <option value="online">Online</option>
            <option value="either">Either</option>
          </select>
        </label>

        <label className="field">
          Session length
          <select value={preview.duration} onChange={(e) => set('duration', Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        Topics
        <div className="chips editable-chips">
          {preview.topics.map((t) => (
            <span key={t}>
              {t}
              <button type="button" onClick={() => removeTopic(t)} aria-label={`Remove ${t}`}>×</button>
            </span>
          ))}
          <input
            placeholder="Add a topic…"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic() } }}
          />
        </div>
      </label>

      <div className="review-actions">
        <button className="outline" onClick={onBack} disabled={busy}>Edit description</button>
        <button className="primary" onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner /> : <>Confirm &amp; find matches <Icon name="arrow" size={16} /></>}
        </button>
      </div>
    </div>
  )
}

function TutorReliability({ stats }) {
  if (!stats || stats.isNew) return <span className="reliability new">New tutor</span>
  const parts = []
  if (stats.avgRating != null) parts.push(`⭐ ${stats.avgRating}/5 (${stats.ratingCount})`)
  if (stats.sessionsCompleted) parts.push(`${stats.sessionsCompleted} session${stats.sessionsCompleted === 1 ? '' : 's'} done`)
  if (stats.responseRate != null) parts.push(`${stats.responseRate}% response rate`)
  if (!parts.length) return <span className="reliability new">New tutor</span>
  return <span className="reliability">{parts.join(' · ')}</span>
}

function MatchCard({ match, open, sent, busy, onToggle, onSend }) {
  const [message, setMessage] = useState(`Hi! I need help understanding ${match.moduleName}.`)
  const band = match.score >= 80 ? 'excellent' : match.score >= 60 ? 'good' : match.score >= 40 ? 'possible' : 'low'

  return (
    <article className="match-card">
      {match.reciprocal && (
        <div className="reciprocal-banner">
          🔄 Reciprocal match — they need help with <b>{match.reciprocal.moduleName}</b>, and you can teach it. Help each other out!
        </div>
      )}
      <div className="match-card-top">
        <Avatar name={match.tutor.name || match.tutor.email} id={match.tutorId} />
        <div className="match-card-info">
          <h3>{match.tutor.name || 'A NYPkaki student'}</h3>
          <p className="course">
            {match.tutor.course || 'Course not set yet'} {match.tutor.year && <><b>•</b> Year {match.tutor.year}</>}
          </p>
          <TutorReliability stats={match.tutorStats} />
        </div>
        <div className={'score-pill ' + band}>
          <b>{match.score}%</b>
          <span>{BAND_LABELS[band]}</span>
        </div>
      </div>

      {band === 'possible' || band === 'low' ? <span className="partial-badge">Partial match</span> : null}

      <p className="explanation">{match.explanation}</p>

      <div className="chips">
        {match.coveredTopics.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>

      <div className="match-card-actions">
        <button className="view-tutors" onClick={onToggle}>
          {open ? 'Hide breakdown' : 'Why this match?'} <Icon name="chevron" size={14} />
        </button>
        {sent ? (
          <span className="sent-tag">
            <Icon name="check" size={14} /> Request sent
          </span>
        ) : (
          <button className="card-btn inline" onClick={() => onSend(message)} disabled={busy}>
            Request tutoring <Icon name="arrow" size={16} />
          </button>
        )}
      </div>

      {open && (
        <div className="breakdown">
          {match.breakdown.map((f) => (
            <div className="breakdown-row" key={f.label}>
              <div className="breakdown-label">
                <span>{f.label}</span>
                <b>
                  {f.earned}/{f.max}
                </b>
              </div>
              <div className="breakdown-bar">
                <div className="breakdown-fill" style={{ width: `${(f.earned / f.max) * 100}%` }} />
              </div>
              <p>{f.detail}</p>
            </div>
          ))}
          {!sent && (
            <label className="field">
              Message
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
          )}
        </div>
      )}
    </article>
  )
}
