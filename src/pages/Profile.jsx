import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { Icon } from '../components/Icon.jsx'
import { getAvailability, getTeachingSubjects, replaceAvailability, replaceTeachingSubjects, upsertUserProfile } from '../lib/firestore.js'
import { modulesForCourse, NYP_COURSE_CATALOG, schoolsForCourse } from '../shared/nyp.ts'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FIRST_HOUR = 7
const LAST_HOUR = 23
const INTERVAL_MINUTES = 30
const TIME_ROWS = Array.from({ length: ((LAST_HOUR - FIRST_HOUR) * 60) / INTERVAL_MINUTES }, (_, index) => index)

function schoolForCourse(course) {
  return schoolsForCourse(course)[0] || NYP_COURSE_CATALOG[0].school
}

function timeForRow(row) {
  const minutes = FIRST_HOUR * 60 + row * INTERVAL_MINUTES
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function labelForRow(row) {
  const minutes = FIRST_HOUR * 60 + row * INTERVAL_MINUTES
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour > 12 ? hour - 12 : hour}:` + `${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function shortLabelForRow(row) {
  return labelForRow(row).replace(':00 ', ' ')
}

function availabilityToCells(slots) {
  const selected = new Set()
  slots.forEach(({ day, startTime, endTime }) => {
    const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5))
    const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5))
    TIME_ROWS.forEach((row) => {
      const cellStart = FIRST_HOUR * 60 + row * INTERVAL_MINUTES
      if (day && start <= cellStart && end >= cellStart + INTERVAL_MINUTES) selected.add(`${day}-${row}`)
    })
  })
  return selected
}

function cellsToAvailability(cells) {
  return WEEKDAYS.flatMap((day) => {
    const rows = TIME_ROWS.filter((row) => cells.has(`${day}-${row}`))
    const ranges = []
    let start = null
    let previous = null
    rows.forEach((row) => {
      if (start === null || row !== previous + 1) {
        if (start !== null) ranges.push({ day, startTime: timeForRow(start), endTime: timeForRow(previous + 1) })
        start = row
      }
      previous = row
    })
    if (start !== null) ranges.push({ day, startTime: timeForRow(start), endTime: timeForRow(previous + 1) })
    return ranges
  })
}

export function Profile() {
  const { user, refreshProfile } = useAuth()
  const [form, setForm] = useState({
    name: user.name || '',
    school: user.school || schoolForCourse(user.course),
    course: user.course || NYP_COURSE_CATALOG[0].courses[0],
    bio: user.bio || '',
    preferredFormat: user.preferredFormat || 'either',
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  const [teaching, setTeaching] = useState([])
  const [selectedModules, setSelectedModules] = useState(new Set())
  const [loadingTeaching, setLoadingTeaching] = useState(true)
  const [savingTeaching, setSavingTeaching] = useState(false)

  const [slots, setSlots] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [savingSlots, setSavingSlots] = useState(false)
  const [selectedCells, setSelectedCells] = useState(new Set())
  const dragRef = useRef(null)

  const [error, setError] = useState('')
  const location = useLocation()

  useEffect(() => {
    if (location.hash === '#teaching') {
      document.getElementById('teaching')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.hash])

  useEffect(() => {
    async function load() {
      try {
        const [subjects, availability] = await Promise.all([getTeachingSubjects(user.userId), getAvailability(user.userId)])
        setTeaching(subjects)
        setSelectedModules(new Set(subjects.map((s) => s.moduleId)))
        setSlots(availability)
        setSelectedCells(availabilityToCells(availability))
      } catch (err) {
        setError(err.message || 'Could not load your teaching profile.')
      } finally {
        setLoadingTeaching(false)
        setLoadingSlots(false)
      }
    }
    load()
  }, [user.userId])

  async function saveProfile(e) {
    e.preventDefault()
    setSavingProfile(true)
    setProfileSaved(false)
    setError('')
    try {
      await upsertUserProfile(user.userId, form)
      await refreshProfile()
      setProfileSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingProfile(false)
    }
  }

  function toggleModule(moduleId) {
    setSelectedModules((prev) => {
      const next = new Set(prev)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }

  async function saveTeaching() {
    setSavingTeaching(true)
    setError('')
    try {
      const modules = modulesForCourse(form.course)
      const subjects = [...selectedModules].map((moduleId) => {
        const existing = teaching.find((t) => t.moduleId === moduleId)
        const mod = modules.find((m) => m.moduleId === moduleId)
        return existing || { moduleId, moduleName: mod?.moduleName || moduleId, topics: mod?.topics.slice(0, 2) || [], confidence: 4, experience: 0 }
      })
      await replaceTeachingSubjects(user.userId, subjects)
      setTeaching(subjects)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingTeaching(false)
    }
  }

  async function saveCells(cells) {
    setSavingSlots(true)
    setError('')
    try {
      const next = cellsToAvailability(cells)
      await replaceAvailability(user.userId, next)
      setSlots(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingSlots(false)
    }
  }

  function updateCell(day, row, shouldSelect) {
    const key = `${day}-${row}`
    const next = new Set(dragRef.current?.cells || selectedCells)
    if (shouldSelect) next.add(key)
    else next.delete(key)
    if (dragRef.current) dragRef.current.cells = next
    setSelectedCells(next)
  }

  function cellFromTarget(target) {
    const cell = target?.closest?.('[data-availability-cell]')
    if (!cell) return null
    return { day: cell.dataset.day, row: Number(cell.dataset.row) }
  }

  function startDrag(event) {
    if (savingSlots) return
    const cell = cellFromTarget(event.target)
    if (!cell) return
    event.preventDefault()
    const key = `${cell.day}-${cell.row}`
    const shouldSelect = !selectedCells.has(key)
    dragRef.current = { cells: new Set(selectedCells), shouldSelect, lastKey: key }
    event.currentTarget.setPointerCapture(event.pointerId)
    updateCell(cell.day, cell.row, shouldSelect)
  }

  function continueDrag(event) {
    const drag = dragRef.current
    if (!drag) return
    const cell = cellFromTarget(document.elementFromPoint(event.clientX, event.clientY))
    if (!cell) return
    const key = `${cell.day}-${cell.row}`
    if (key === drag.lastKey) return
    drag.lastKey = key
    updateCell(cell.day, cell.row, drag.shouldSelect)
  }

  function finishDrag(event) {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    saveCells(drag.cells)
  }

  function toggleCell(day, row) {
    if (savingSlots) return
    const next = new Set(selectedCells)
    const key = `${day}-${row}`
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedCells(next)
    saveCells(next)
  }

  function clearAvailability() {
    if (savingSlots || selectedCells.size === 0) return
    setSelectedCells(new Set())
    saveCells(new Set())
  }

  function rangeEndFor(day, row) {
    let end = row
    while (selectedCells.has(`${day}-${end + 1}`)) end += 1
    return end
  }

  const courseModules = modulesForCourse(form.course)
  const selectedWindows = cellsToAvailability(selectedCells)
  const schoolCourses = NYP_COURSE_CATALOG.find((group) => group.school === form.school)?.courses || []

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">YOUR PROFILE</p>
          <h1>Keep your details current</h1>
          <p className="sub">This is what classmates see when NYPkaki matches you.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card">
        <h2>About you</h2>
        <form onSubmit={saveProfile}>
          <div className="form-grid">
            <label className="field">
              Name
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="field">
              Preferred format
              <select value={form.preferredFormat} onChange={(e) => setForm((f) => ({ ...f, preferredFormat: e.target.value }))}>
                <option value="in-person">In-person</option>
                <option value="online">Online</option>
                <option value="either">Either</option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label className="field">
              School
              <select value={form.school} onChange={(e) => setForm((f) => ({ ...f, school: e.target.value, course: NYP_COURSE_CATALOG.find((group) => group.school === e.target.value)?.courses[0] || '' }))}>
                {NYP_COURSE_CATALOG.map(({ school }) => <option key={school} value={school}>{school}</option>)}
              </select>
            </label>
            <label className="field">
              Course
              <select value={form.course} onChange={(e) => setForm((f) => ({ ...f, course: e.target.value }))}>
                {schoolCourses.map((course) => <option key={course} value={course}>{course}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            Bio
            <textarea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
          </label>
          <button className="primary" type="submit" disabled={savingProfile}>
            {savingProfile ? <Spinner /> : profileSaved ? <><Icon name="check" size={16} /> Saved</> : 'Save changes'}
          </button>
        </form>
      </div>

      <div className="card" id="teaching">
        <h2>What can you teach?</h2>
        <p className="recommend-copy">Pick from the competencies in your own course.</p>
        {loadingTeaching ? (
          <Spinner />
        ) : courseModules.length === 0 ? (
          <p className="recommend-copy">Save your course above to see teachable competencies.</p>
        ) : (
          <>
            <div className="check-list">
              {courseModules.map((m) => (
                <label key={m.moduleId}>
                  <input type="checkbox" checked={selectedModules.has(m.moduleId)} onChange={() => toggleModule(m.moduleId)} />
                  {m.moduleName}
                </label>
              ))}
            </div>
            <button className="primary" onClick={saveTeaching} disabled={savingTeaching}>
              {savingTeaching ? <Spinner /> : 'Save tutor profile'}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2>Your availability</h2>
        <p className="recommend-copy">Drag across the weekly calendar to mark when you're free.</p>
        {loadingSlots ? (
          <Spinner />
        ) : (
          <>
            <div className="availability-toolbar">
              <span><i /> Available · 30 minute blocks</span>
              <button type="button" onClick={clearAvailability} disabled={savingSlots || selectedCells.size === 0}>Clear all</button>
            </div>
            <div className="availability-selection" aria-live="polite">
              {selectedWindows.length ? (
                <>
                  <b>Selected times</b>
                  <div>
                    {selectedWindows.slice(0, 4).map((slot) => (
                      <span key={`${slot.day}-${slot.startTime}`}>{slot.day} · {labelForRow((Number(slot.startTime.slice(0, 2)) * 60 + Number(slot.startTime.slice(3, 5)) - FIRST_HOUR * 60) / INTERVAL_MINUTES)}–{labelForRow((Number(slot.endTime.slice(0, 2)) * 60 + Number(slot.endTime.slice(3, 5)) - FIRST_HOUR * 60) / INTERVAL_MINUTES)}</span>
                    ))}
                    {selectedWindows.length > 4 && <span>+{selectedWindows.length - 4} more</span>}
                  </div>
                </>
              ) : <span>Select a time to see it here.</span>}
            </div>
            <div className="availability-calendar-wrap">
              <div
                className={`availability-calendar${savingSlots ? ' is-saving' : ''}`}
                onPointerDown={startDrag}
                onPointerMove={continueDrag}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
              >
                <div className="calendar-corner" aria-hidden="true" />
                {WEEKDAYS.map((day) => <div className="calendar-day" key={day}>{day}</div>)}
                {TIME_ROWS.map((row) => (
                  <div className="calendar-row" key={row}>
                    <div className="calendar-time">{row % 2 === 0 ? labelForRow(row) : ''}</div>
                    {WEEKDAYS.map((day) => {
                      const selected = selectedCells.has(`${day}-${row}`)
                      const rangeStart = selected && !selectedCells.has(`${day}-${row - 1}`)
                      const rangeEnd = selected && !selectedCells.has(`${day}-${row + 1}`)
                      const endRow = rangeStart ? rangeEndFor(day, row) : row
                      return (
                        <button
                          aria-label={`${day} ${labelForRow(row)} to ${labelForRow(row + 1)}`}
                          aria-pressed={selected}
                          className={`availability-cell${selected ? ' selected' : ''}${rangeStart ? ' range-start' : ''}${rangeEnd ? ' range-end' : ''}`}
                          data-availability-cell
                          data-day={day}
                          data-row={row}
                          disabled={savingSlots}
                          key={day}
                          onClick={(event) => {
                            if (event.detail === 0) toggleCell(day, row)
                          }}
                          style={rangeStart ? { '--range-rows': endRow - row + 1 } : undefined}
                          type="button"
                        >
                          {rangeStart && <span className="availability-cell-time">{shortLabelForRow(row)}–{shortLabelForRow(endRow + 1)}</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
            <p className="availability-status" aria-live="polite">{savingSlots ? 'Saving availability…' : slots.length ? `${slots.length} availability window${slots.length === 1 ? '' : 's'} saved` : 'No availability selected yet'}</p>
          </>
        )}
      </div>
    </>
  )
}
