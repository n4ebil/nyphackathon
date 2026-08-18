import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { Icon } from '../components/Icon.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { MODULES, findModule, modulesForCourse } from '../shared/nyp.ts'
import { buildExplanation, findMatches } from '../shared/matching.ts'
import { computeTutorStats } from '../shared/reliability.ts'
import {
  getAvailability,
  listAllAvailability,
  listAllFeedback,
  listAllLearningRequests,
  listAllMatchRequests,
  listAllSessions,
  listAllTeachingSubjects,
  listUsers,
  sendMatchRequest,
} from '../lib/firestore.js'
import { previewNaturalLanguageRequest, submitLearningRequest } from '../lib/match.js'

const BAND_LABELS = { excellent: 'Great fit', good: 'Good fit', possible: 'Possible fit', low: 'Not quite' }
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }
const TIME_BUCKETS = [
  ['any', 'Any time'],
  ['morning', 'Morning (before 12pm)'],
  ['afternoon', 'Afternoon (12–5pm)'],
  ['evening', 'Evening (after 5pm)'],
]

function defaultModuleId(student, learningRequests) {
  const mine = learningRequests.filter((r) => r.userId === student.userId).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  if (mine[0]?.moduleId) return mine[0].moduleId
  const courseModules = modulesForCourse(student.course)
  return (courseModules[0] || MODULES[0])?.moduleId
}

function bucketOf(startTime) {
  const h = parseInt(startTime.split(':')[0], 10)
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

export function FindTutors() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [data, setData] = useState(null)
  const [filters, setFilters] = useState({ search: '', moduleId: '', topics: new Set(), day: 'any', time: 'any', format: 'any' })
  const [sentIds, setSentIds] = useState(new Set())
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [profileTutor, setProfileTutor] = useState(null)
  const [whyMatchTutor, setWhyMatchTutor] = useState(null)
  const [waitlisted, setWaitlisted] = useState(false)

  // Natural-language "describe what you need" flow.
  const [nlText, setNlText] = useState('')
  const [nlBusy, setNlBusy] = useState(false)
  const [nlError, setNlError] = useState('')
  const [nlPreview, setNlPreview] = useState(null)
  const [nlEditing, setNlEditing] = useState(false)
  const [nlSlots, setNlSlots] = useState(null)
  const [nlApplied, setNlApplied] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const [users, teachingSubjects, availability, studentSlots, learningRequests, feedback, sessions, matchRequests] =
          await Promise.all([
            listUsers(),
            listAllTeachingSubjects(),
            listAllAvailability(),
            getAvailability(user.userId),
            listAllLearningRequests(),
            listAllFeedback(),
            listAllSessions(),
            listAllMatchRequests(),
          ])
        if (cancelled) return

        const tutorStatsById = {}
        for (const u of users) {
          if (u.userId === user.userId) continue
          tutorStatsById[u.userId] = computeTutorStats({ tutorId: u.userId, feedback, sessions, matchRequests, teachingSubjects })
        }

        setData({ users, teachingSubjects, availability, studentSlots, learningRequests, tutorStatsById })
        setFilters((f) => {
          const moduleId = defaultModuleId(user, learningRequests)
          const mod = moduleId ? findModule(moduleId) : null
          return { ...f, moduleId: moduleId || '', topics: new Set(mod?.topics || []) }
        })
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Could not load tutors.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.userId])

  const selectedModule = filters.moduleId ? findModule(filters.moduleId) : null
  const courseModules = useMemo(() => {
    const own = modulesForCourse(user.course)
    return own.length ? own : MODULES
  }, [user.course])

  const request = useMemo(() => {
    if (!selectedModule) return null
    return {
      requestId: 'browse',
      userId: user.userId,
      moduleId: selectedModule.moduleId,
      moduleName: selectedModule.moduleName,
      topics: [...filters.topics],
      description: '',
      urgency: 'medium',
      deadline: null,
      preferredFormat: filters.format === 'any' ? user.preferredFormat || 'either' : filters.format,
      duration: 60,
    }
  }, [selectedModule, filters.topics, filters.format, user])

  const matches = useMemo(() => {
    if (!request || !data) return []
    const scored = findMatches({
      student: user,
      request,
      studentSlots: nlSlots || data.studentSlots,
      candidates: data.users,
      teachingSubjects: data.teachingSubjects,
      availability: data.availability,
      studentTeaches: data.teachingSubjects.filter((s) => s.userId === user.userId),
      openRequests: data.learningRequests,
      tutorStats: data.tutorStatsById,
    })
    return scored.map((m) => ({ ...m, explanation: buildExplanation(m, request) }))
  }, [request, data, user, nlSlots])

  const filteredMatches = useMemo(() => {
    if (!data) return []
    const search = filters.search.trim().toLowerCase()
    return matches.filter((m) => {
      if (filters.day !== 'any' || filters.time !== 'any') {
        const tutorSlots = data.availability.filter((a) => a.userId === m.tutorId)
        const ok = tutorSlots.some(
          (s) => (filters.day === 'any' || s.day === filters.day) && (filters.time === 'any' || bucketOf(s.startTime) === filters.time),
        )
        if (!ok) return false
      }
      if (!search) return true
      const haystack = [m.tutor.name, m.moduleName, ...m.coveredTopics, ...(tutorTopics(data, m) || [])].join(' ').toLowerCase()
      return haystack.includes(search)
    })
  }, [matches, filters.search, filters.day, filters.time, data])

  function tutorTopics(d, match) {
    return d.teachingSubjects.find((s) => s.userId === match.tutorId && s.moduleId === match.moduleId)?.topics
  }

  function updateModule(moduleId) {
    const mod = findModule(moduleId)
    setFilters((f) => ({ ...f, moduleId, topics: new Set(mod?.topics || []) }))
    setWaitlisted(false)
  }

  function toggleTopic(topic) {
    setFilters((f) => {
      const next = new Set(f.topics)
      if (next.has(topic)) next.delete(topic)
      else next.add(topic)
      return { ...f, topics: next }
    })
  }

  function clearFilters() {
    const moduleId = defaultModuleId(user, data?.learningRequests || [])
    const mod = moduleId ? findModule(moduleId) : null
    setFilters({ search: '', moduleId: moduleId || '', topics: new Set(mod?.topics || []), day: 'any', time: 'any', format: 'any' })
    setWaitlisted(false)
    setNlSlots(null)
    setNlApplied(null)
  }

  async function understandRequest() {
    if (!nlText.trim()) return
    setNlBusy(true)
    setNlError('')
    try {
      const preview = await previewNaturalLanguageRequest(user, nlText.trim())
      setNlPreview(preview)
      setNlEditing(false)
    } catch (err) {
      setNlError(err.message || 'Could not read that request. Please try again.')
    } finally {
      setNlBusy(false)
    }
  }

  function applyNlPreview() {
    if (!nlPreview) return
    setFilters((f) => ({
      ...f,
      moduleId: nlPreview.moduleId,
      topics: new Set(nlPreview.topics),
      format: nlPreview.preferredFormat,
      day: nlPreview.availability?.day || f.day,
      time: nlPreview.availability?.startTime ? bucketOf(nlPreview.availability.startTime) : f.time,
    }))
    setNlSlots(
      nlPreview.availability
        ? [{ userId: user.userId, day: nlPreview.availability.day, startTime: nlPreview.availability.startTime || '00:00', endTime: nlPreview.availability.endTime || '23:59' }]
        : null,
    )
    setNlApplied(nlPreview)
    setNlPreview(null)
    setNlText('')
  }

  async function requestSession(match, message) {
    setBusyId(match.matchId)
    setActionError('')
    try {
      // A tutor's best-scoring subject can be a related-but-different module than
      // the one filtered on — in that case filters.topics belongs to the wrong
      // module's catalog, so fall back to the topics actually covered instead.
      const sameModule = match.moduleId === filters.moduleId
      const topics = sameModule ? [...filters.topics] : match.coveredTopics
      // If this search came from the "describe what you need" flow for the same
      // module, carry its goal/urgency/deadline/duration through — that's real
      // context the student already gave, not something to silently drop.
      const nl = sameModule && nlApplied?.moduleId === match.moduleId ? nlApplied : null
      const fields = {
        moduleId: match.moduleId,
        moduleName: match.moduleName,
        topics,
        description: nl?.description || `Looking for help with ${match.moduleName}${topics.length ? ' — ' + topics.join(', ') : ''}.`,
        goal: nl?.goal,
        urgency: nl?.urgency || 'medium',
        deadline: nl?.deadline || null,
        preferredFormat: request.preferredFormat,
        duration: nl?.duration || 60,
      }
      const saved = await submitLearningRequest(user, fields.description, fields)
      const matchId = `${saved.requestId}--${match.tutorId}`
      await sendMatchRequest({
        matchId,
        studentId: user.userId,
        tutorId: match.tutorId,
        moduleName: match.moduleName,
        message,
        status: 'pending',
        createdAt: new Date().toISOString(),
        score: match.score,
      })
      setSentIds((prev) => new Set(prev).add(match.tutorId + '--' + match.moduleId))
    } catch (err) {
      setActionError(err.message || 'Could not send that request.')
    } finally {
      setBusyId(null)
    }
  }

  async function joinWaitlist() {
    if (!selectedModule) return
    try {
      await submitLearningRequest(user, `Looking for a tutor for ${selectedModule.moduleName}.`, {
        moduleId: selectedModule.moduleId,
        moduleName: selectedModule.moduleName,
        topics: [...filters.topics],
        urgency: 'low',
        deadline: null,
        preferredFormat: request.preferredFormat,
        duration: 60,
      })
      setWaitlisted(true)
    } catch (err) {
      setActionError(err.message || 'Could not save that request.')
    }
  }

  const noOneTeaches = request && data && !data.teachingSubjects.some((s) => s.moduleId === request.moduleId && s.userId !== user.userId)

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">FIND A TUTOR</p>
          <h1>Browse tutors on NYPkaki</h1>
          <p className="sub">Filter by module, topic, availability and format — every match % is computed from real data.</p>
        </div>
      </div>

      {loadError && <Banner kind="error">{loadError}</Banner>}
      {actionError && <Banner kind="error">{actionError}</Banner>}

      {loading || !data ? (
        <AppLoader compact />
      ) : (
        <>
          <NaturalLanguageCard
            text={nlText}
            setText={setNlText}
            busy={nlBusy}
            error={nlError}
            preview={nlPreview}
            editing={nlEditing}
            setEditing={setNlEditing}
            setPreview={setNlPreview}
            applied={nlApplied}
            course={user.course}
            onUnderstand={understandRequest}
            onApply={applyNlPreview}
            onDiscard={() => { setNlPreview(null); setNlText('') }}
          />

          <div className="card filter-bar">
            <div className="filter-row">
              <label className="field filter-search">
                Search
                <div className="search-input">
                  <Icon name="search" size={15} />
                  <input
                    placeholder="Search by tutor, module or topic…"
                    value={filters.search}
                    onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  />
                </div>
              </label>
              <label className="field">
                Module
                <select value={filters.moduleId} onChange={(e) => updateModule(e.target.value)}>
                  {courseModules.map((m) => (
                    <option key={m.moduleId} value={m.moduleId}>{m.moduleName}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Day
                <select value={filters.day} onChange={(e) => setFilters((f) => ({ ...f, day: e.target.value }))}>
                  <option value="any">Any day</option>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Time
                <select value={filters.time} onChange={(e) => setFilters((f) => ({ ...f, time: e.target.value }))}>
                  {TIME_BUCKETS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Format
                <select value={filters.format} onChange={(e) => setFilters((f) => ({ ...f, format: e.target.value }))}>
                  <option value="any">Any format</option>
                  <option value="in-person">In-person</option>
                  <option value="online">Online</option>
                  <option value="either">Either</option>
                </select>
              </label>
            </div>

            {selectedModule && selectedModule.topics.length > 0 && (
              <div className="filter-topics">
                <span className="filter-topics-label">Topics</span>
                <div className="check-pills">
                  {selectedModule.topics.map((t) => (
                    <label key={t} className={filters.topics.has(t) ? 'pill-check on' : 'pill-check'}>
                      <input type="checkbox" checked={filters.topics.has(t)} onChange={() => toggleTopic(t)} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button className="clear-filters" onClick={clearFilters}>
              <Icon name="x" size={13} /> Clear filters
            </button>
          </div>

          <section className="find-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{filteredMatches.length} TUTOR{filteredMatches.length === 1 ? '' : 'S'} FOR {selectedModule?.moduleName?.toUpperCase()}</p>
                <h2>{filteredMatches.length && filteredMatches[0].score < 60 ? 'Closest matches' : 'Ranked by fit'}</h2>
              </div>
            </div>

            {noOneTeaches ? (
              <div className="empty-state">
                <span className="empty-icon">🔍</span>
                <p>No one on NYPkaki teaches {selectedModule?.moduleName} yet.</p>
                {!waitlisted ? (
                  <button className="card-btn inline" onClick={joinWaitlist}>
                    Join waitlist <Icon name="check" size={14} />
                  </button>
                ) : (
                  <span className="sent-tag">
                    <Icon name="check" size={14} /> You're on the waitlist
                  </span>
                )}
              </div>
            ) : filteredMatches.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">🧭</span>
                <p>No tutors match these filters. Try widening the day, time or format.</p>
              </div>
            ) : (
              <>
                {filteredMatches[0].score < 60 && (
                  <p className="recommend-copy no-exact-note">
                    Nobody's a strong fit for this yet — here's who's closest, ranked by how much they overlap with what you need.
                  </p>
                )}
                <div className="match-list">
                  {filteredMatches.map((m) => (
                    <TutorCard
                      key={m.matchId}
                      match={m}
                      topics={tutorTopics(data, m) || []}
                      slots={data.availability.filter((a) => a.userId === m.tutorId)}
                      sent={sentIds.has(m.tutorId + '--' + m.moduleId)}
                      busy={busyId === m.matchId}
                      onSend={(message) => requestSession(m, message)}
                      onViewProfile={() => setProfileTutor(m)}
                      onWhyMatch={() => setWhyMatchTutor(m)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}

      {profileTutor && (
        <TutorProfileModal
          match={profileTutor}
          subjects={data.teachingSubjects.filter((s) => s.userId === profileTutor.tutorId)}
          slots={data.availability.filter((a) => a.userId === profileTutor.tutorId)}
          onClose={() => setProfileTutor(null)}
        />
      )}

      {whyMatchTutor && request && (
        <WhyMatchModal
          match={whyMatchTutor}
          request={request}
          sent={sentIds.has(whyMatchTutor.tutorId + '--' + whyMatchTutor.moduleId)}
          busy={busyId === whyMatchTutor.matchId}
          onSend={(message) => requestSession(whyMatchTutor, message)}
          onClose={() => setWhyMatchTutor(null)}
        />
      )}
    </>
  )
}

const URGENCY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }

function formatAvailability(hint) {
  if (!hint) return 'Not specified'
  if (!hint.startTime) return DAY_FULL[hint.day] || hint.day
  return `${DAY_FULL[hint.day] || hint.day}, ${to12h(hint.startTime)} – ${to12h(hint.endTime)}`
}

function formatDeadline(iso) {
  if (!iso) return 'Not specified'
  return new Date(iso).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short' })
}

/**
 * "Describe what you need" — the natural-language alternative to manually
 * setting the filters below. Understands the request (AI picks the module +
 * generates a goal, everything else is parsed deterministically — see
 * previewNaturalLanguageRequest), shows exactly what it understood, and only
 * touches the real filters/scoring once the student confirms with Find
 * Matches. This is the one AI feature in the app that isn't scoped to a
 * single field — see lib/ai.js and shared/nlp.ts for the split.
 */
function NaturalLanguageCard({ text, setText, busy, error, preview, editing, setEditing, setPreview, applied, course, onUnderstand, onApply, onDiscard }) {
  if (applied && !preview) {
    return (
      <div className="card nl-card nl-applied">
        <div className="nl-applied-row">
          <Icon name="spark" size={15} />
          <p>
            Using your description: <b>"{applied.description}"</b> — matched to <b>{applied.moduleName}</b>
            {applied.availability ? ` with availability for ${formatAvailability(applied.availability)}` : ''}.
          </p>
        </div>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="card nl-card">
        <p className="eyebrow">DESCRIBE WHAT YOU NEED</p>
        <h2>Tell NYPkaki in your own words</h2>
        <p className="recommend-copy">e.g. "I need help with linked lists for my test on Friday. I'm free Wednesday after 5pm."</p>
        {error && <Banner kind="error">{error}</Banner>}
        <label className="field">
          <textarea placeholder="What do you need help with, and when are you free?" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="match-btn" onClick={onUnderstand} disabled={busy || !text.trim()}>
          <span><Icon name="spark" size={15} /></span>
          {busy ? <Spinner /> : 'Understand my request'}
        </button>
      </div>
    )
  }

  if (editing) {
    return <NlEditForm preview={preview} setPreview={setPreview} course={course} onDone={() => setEditing(false)} />
  }

  return (
    <div className="card nl-card">
      <p className="eyebrow">AI UNDERSTOOD</p>
      <ul className="nl-understood">
        <li><span>Module</span><b>{preview.moduleName}</b></li>
        <li><span>Topic{preview.topics.length === 1 ? '' : 's'}</span><b>{preview.topics.length ? preview.topics.join(', ') : 'Not specified'}</b></li>
        <li><span>Goal</span><b>{preview.goal}</b></li>
        <li><span>Deadline</span><b>{formatDeadline(preview.deadline)}</b></li>
        <li><span>Urgency</span><b>{URGENCY_LABEL[preview.urgency]}</b></li>
        <li><span>Availability</span><b>{formatAvailability(preview.availability)}</b></li>
        <li><span>Format</span><b>{preview.preferredFormat === 'either' ? 'Either' : preview.preferredFormat === 'online' ? 'Online' : 'In-person'}</b></li>
      </ul>
      <div className="nl-actions">
        <button className="outline" onClick={() => setEditing(true)}>Edit</button>
        <button className="primary" onClick={onApply}>Find Matches <Icon name="arrow" size={16} /></button>
        <button className="text-btn" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  )
}

function NlEditForm({ preview, setPreview, course, onDone }) {
  const [topicInput, setTopicInput] = useState('')
  const options = useMemo(() => {
    const own = modulesForCourse(course)
    return own.length ? own : MODULES
  }, [course])

  function set(field, value) {
    setPreview((p) => ({ ...p, [field]: value }))
  }

  function addTopic() {
    const t = topicInput.trim()
    if (!t || preview.topics.includes(t)) return
    set('topics', [...preview.topics, t])
    setTopicInput('')
  }

  return (
    <div className="card nl-card">
      <p className="eyebrow">EDIT WHAT AI UNDERSTOOD</p>
      <p className="recommend-copy">"{preview.description}"</p>

      <div className="review-grid">
        <label className="field">
          Module
          <select value={preview.moduleId} onChange={(e) => {
            const m = MODULES.find((mod) => mod.moduleId === e.target.value)
            if (m) setPreview((p) => ({ ...p, moduleId: m.moduleId, moduleName: m.moduleName }))
          }}>
            {(options.some((m) => m.moduleId === preview.moduleId) ? options : [{ moduleId: preview.moduleId, moduleName: preview.moduleName }, ...options]).map((m) => (
              <option key={m.moduleId} value={m.moduleId}>{m.moduleName}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Goal
          <input value={preview.goal} onChange={(e) => set('goal', e.target.value)} />
        </label>
        <label className="field">
          Urgency
          <select value={preview.urgency} onChange={(e) => set('urgency', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="field">
          Deadline
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
          Available day
          <select
            value={preview.availability?.day || ''}
            onChange={(e) => set('availability', e.target.value ? { ...preview.availability, day: e.target.value } : undefined)}
          >
            <option value="">Not specified</option>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {preview.availability?.day && (
          <>
            <label className="field">
              From
              <input type="time" value={preview.availability.startTime || '06:00'} onChange={(e) => set('availability', { ...preview.availability, startTime: e.target.value })} />
            </label>
            <label className="field">
              Until
              <input type="time" value={preview.availability.endTime || '23:00'} onChange={(e) => set('availability', { ...preview.availability, endTime: e.target.value })} />
            </label>
          </>
        )}
      </div>

      <label className="field">
        Topics
        <div className="chips editable-chips">
          {preview.topics.map((t) => (
            <span key={t}>
              {t}
              <button type="button" onClick={() => set('topics', preview.topics.filter((x) => x !== t))} aria-label={`Remove ${t}`}>×</button>
            </span>
          ))}
          <input placeholder="Add a topic…" value={topicInput} onChange={(e) => setTopicInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic() } }} />
        </div>
      </label>

      <div className="review-actions">
        <button className="primary" onClick={onDone}>Done editing <Icon name="check" size={16} /></button>
      </div>
    </div>
  )
}

/** "14:30" -> "2:30 PM" */
function to12h(time) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function slotMinutes(slot) {
  const [sh, sm] = slot.startTime.split(':').map(Number)
  const [eh, em] = slot.endTime.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

/** Longest shared slot wins — the most flexible real overlap, not just the first one found. */
function bestSharedSlot(sharedSlots) {
  if (!sharedSlots.length) return null
  return [...sharedSlots].sort((a, b) => slotMinutes(b) - slotMinutes(a))[0]
}

/**
 * Turns the deterministic score breakdown into a plain-language checklist —
 * every line traces back to a real breakdown factor, sharedSlots, or
 * tutorStats value. Nothing here is invented.
 */
function buildChecklist(match, request) {
  const factor = (label) => match.breakdown.find((f) => f.label === label)
  const items = []

  const module = factor('Module compatibility')
  if (module.earned === module.max) items.push({ ok: true, text: `Same module: ${request.moduleName}` })
  else if (module.earned > 0) items.push({ ok: true, text: `Related module: ${match.moduleName}` })
  else items.push({ ok: false, text: `Different module — ${match.moduleName} isn't a close match for ${request.moduleName}` })

  if (match.coveredTopics.length) {
    const complete = match.coveredTopics.length === request.topics.length
    items.push({
      ok: true,
      text: complete
        ? `Same topic${match.coveredTopics.length === 1 ? '' : 's'}: ${match.coveredTopics.join(', ')}`
        : `Covers ${match.coveredTopics.length}/${request.topics.length} topics: ${match.coveredTopics.join(', ')}`,
    })
  } else if (request.topics.length) {
    items.push({ ok: false, text: `Doesn't cover the topics you asked about yet` })
  } else {
    items.push({ ok: null, text: `No specific topics requested` })
  }

  if (match.sharedSlots.length) {
    items.push({ ok: true, text: `${match.sharedSlots.length} overlapping availability slot${match.sharedSlots.length === 1 ? '' : 's'}` })
  } else {
    items.push({ ok: false, text: `No overlapping availability yet` })
  }

  const format = factor('Learning format')
  const fmtLabel = request.preferredFormat === 'either' ? 'flexible' : request.preferredFormat
  if (format.earned === format.max) items.push({ ok: true, text: `Both prefer ${fmtLabel} sessions` })
  else if (format.earned > 0) items.push({ ok: true, text: `Flexible on format — ${match.tutor.preferredFormat === 'either' ? 'they are' : 'you are'} happy either way` })
  else items.push({ ok: false, text: `Different format preferences — you want ${request.preferredFormat}, they prefer ${match.tutor.preferredFormat}` })

  const exp = factor('Tutor experience')
  items.push({ ok: exp.earned > 0 ? true : null, text: exp.detail })

  const stats = match.tutorStats
  if (stats && !stats.isNew && stats.sessionsCompleted > 0) {
    items.push({
      ok: true,
      text: `Tutor has completed ${stats.sessionsCompleted} session${stats.sessionsCompleted === 1 ? '' : 's'}${stats.avgRating != null ? ` · rated ${stats.avgRating}/5` : ''}`,
    })
  } else {
    items.push({ ok: null, text: 'New tutor — no completed sessions yet' })
  }

  return items
}

function WhyMatchModal({ match, request, sent, busy, onSend, onClose }) {
  const [message, setMessage] = useState(`Hi! I need help understanding ${match.moduleName}.`)
  const band = match.score >= 80 ? 'excellent' : match.score >= 60 ? 'good' : match.score >= 40 ? 'possible' : 'low'
  const checklist = useMemo(() => buildChecklist(match, request), [match, request])
  const best = bestSharedSlot(match.sharedSlots)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel why-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><Icon name="x" size={16} /></button>

        <div className="why-score">
          <div className={'score-pill xl ' + band}>
            <b>{match.score}%</b>
            <span>{BAND_LABELS[band]}</span>
          </div>
          <div>
            <p className="eyebrow">WHY THIS MATCH</p>
            <h2>{match.tutor.name || 'A NYPkaki student'}</h2>
            <p className="recommend-copy">for {request.moduleName}</p>
          </div>
        </div>

        <ul className="why-checklist">
          {checklist.map((item, i) => (
            <li key={i} className={item.ok === true ? 'ok' : item.ok === false ? 'bad' : 'neutral'}>
              <span className="why-icon">
                {item.ok === true ? <Icon name="check" size={13} /> : item.ok === false ? <Icon name="x" size={12} /> : '–'}
              </span>
              {item.text}
            </li>
          ))}
        </ul>

        <div className="best-time">
          <span className="tutor-topics-label"><Icon name="clock" size={12} /> Best available time</span>
          {best ? (
            <p className="best-time-value">{DAY_FULL[best.day] || best.day}, {to12h(best.startTime)} – {to12h(best.endTime)}</p>
          ) : (
            <p className="recommend-copy">No overlapping availability yet — reach out to arrange a time directly.</p>
          )}
        </div>

        <div className="why-actions">
          {sent ? (
            <span className="sent-tag">
              <Icon name="check" size={14} /> Request sent
            </span>
          ) : (
            <>
              <label className="field">
                Message
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
              </label>
              <button className="primary wide" disabled={busy} onClick={() => onSend(message)}>
                {busy ? <Spinner /> : <>Request Session <Icon name="arrow" size={16} /></>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function formatSlots(slots, max = 3) {
  const sorted = [...slots].sort((a, b) => (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) || a.startTime.localeCompare(b.startTime))
  return { shown: sorted.slice(0, max), extra: Math.max(sorted.length - max, 0) }
}

function TutorCard({ match, topics, slots, sent, busy, onSend, onViewProfile, onWhyMatch }) {
  const [message, setMessage] = useState(`Hi! I need help understanding ${match.moduleName}.`)
  const band = match.score >= 80 ? 'excellent' : match.score >= 60 ? 'good' : match.score >= 40 ? 'possible' : 'low'
  const { shown, extra } = formatSlots(slots)
  const stats = match.tutorStats

  return (
    <article className="match-card tutor-card-v2">
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
        </div>
        <div className={'score-pill ' + band}>
          <b>{match.score}%</b>
          <span>{BAND_LABELS[band]}</span>
        </div>
      </div>

      {band === 'possible' || band === 'low' ? <span className="partial-badge">Partial match</span> : null}

      <div className="tutor-stats-row">
        <span className={stats && !stats.isNew && stats.avgRating != null ? 'tstat rating' : 'tstat rating new'}>
          <Icon name="star" size={13} />
          {stats && !stats.isNew && stats.avgRating != null ? `${stats.avgRating}/5 (${stats.ratingCount})` : 'New tutor'}
        </span>
        <span className="tstat">
          <Icon name="check" size={13} />
          {stats?.sessionsCompleted || 0} session{stats?.sessionsCompleted === 1 ? '' : 's'} completed
        </span>
      </div>

      <p className="explanation">{match.explanation}</p>

      <div className="tutor-topics">
        <span className="tutor-topics-label">Teaches</span>
        <div className="chips">
          {(topics.length ? topics : match.coveredTopics).slice(0, 6).map((t) => (
            <span key={t} className={match.coveredTopics.includes(t) ? 'chip-hit' : ''}>{t}</span>
          ))}
        </div>
      </div>

      <div className="tutor-slots">
        <span className="tutor-topics-label"><Icon name="clock" size={12} /> Available</span>
        {shown.length === 0 ? (
          <span className="no-slots">No availability shared yet</span>
        ) : (
          <div className="slot-chips">
            {shown.map((s, i) => (
              <span key={i}>{s.day} {s.startTime}–{s.endTime}</span>
            ))}
            {extra > 0 && <span className="slot-more">+{extra} more</span>}
          </div>
        )}
      </div>

      <div className="match-card-actions">
        <button className="view-tutors why-btn" onClick={onWhyMatch}>
          <Icon name="spark" size={14} /> Why this match?
        </button>
        <button className="outline profile-btn" onClick={onViewProfile}>View Profile</button>
        {sent ? (
          <span className="sent-tag">
            <Icon name="check" size={14} /> Request sent
          </span>
        ) : (
          <button className="card-btn inline" onClick={() => onSend(message)} disabled={busy}>
            {busy ? <Spinner /> : <>Request Session <Icon name="arrow" size={16} /></>}
          </button>
        )}
      </div>
    </article>
  )
}

function TutorProfileModal({ match, subjects, slots, onClose }) {
  const stats = match.tutorStats
  const { shown, extra } = formatSlots(slots, 8)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><Icon name="x" size={16} /></button>
        <div className="modal-head">
          <Avatar name={match.tutor.name || match.tutor.email} id={match.tutorId} />
          <div>
            <h2>{match.tutor.name || 'A NYPkaki student'}</h2>
            <p className="course">
              {match.tutor.course || 'Course not set yet'} {match.tutor.year && <><b>•</b> Year {match.tutor.year}</>}
            </p>
          </div>
        </div>

        {match.tutor.bio && <p className="modal-bio">{match.tutor.bio}</p>}

        <div className="tutor-stats-row modal-stats">
          <span className={stats && !stats.isNew && stats.avgRating != null ? 'tstat rating' : 'tstat rating new'}>
            <Icon name="star" size={13} />
            {stats && !stats.isNew && stats.avgRating != null ? `${stats.avgRating}/5 (${stats.ratingCount})` : 'New tutor'}
          </span>
          <span className="tstat"><Icon name="check" size={13} /> {stats?.sessionsCompleted || 0} completed</span>
          {stats?.responseRate != null && <span className="tstat"><Icon name="inbox" size={13} /> {stats.responseRate}% response rate</span>}
          {stats?.studentsHelped ? <span className="tstat"><Icon name="user" size={13} /> {stats.studentsHelped} students helped</span> : null}
        </div>

        <div className="modal-section">
          <h3>Teaches</h3>
          {subjects.length === 0 ? (
            <p className="recommend-copy">Hasn't listed anything yet.</p>
          ) : (
            subjects.map((s) => (
              <div className="modal-subject" key={s.moduleId}>
                <div className="modal-subject-head">
                  <b>{s.moduleName}</b>
                  <span>Confidence {s.confidence}/5 · Tutored {s.experience || 0}×</span>
                </div>
                <div className="chips">
                  {s.topics.map((t) => <span key={t}>{t}</span>)}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="modal-section">
          <h3>Availability</h3>
          {shown.length === 0 ? (
            <p className="recommend-copy">No availability shared yet.</p>
          ) : (
            <div className="slot-chips">
              {shown.map((s, i) => <span key={i}>{s.day} {s.startTime}–{s.endTime}</span>)}
              {extra > 0 && <span className="slot-more">+{extra} more</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
