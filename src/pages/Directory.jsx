import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { Icon } from '../components/Icon.jsx'
import {
  addAdminEmail,
  cancelMatchRequest,
  cancelSession,
  deleteClassRequest,
  deleteTeachingSubject,
  deleteUserProfile,
  importDirectoryRows,
  listAdminEmails,
  listAllMatchRequests,
  listAllSessions,
  listAllTeachingSubjects,
  listClassRequests,
  listDirectory,
  listUsers,
  removeAdminEmail,
  upsertUserProfile,
} from '../lib/firestore.js'
import { parseStudentDirectory } from '../lib/csv.js'
import { ADMIN_EMAILS } from '../lib/admin.js'
import { NYP_COURSE_CATALOG, schoolsForCourse } from '../shared/nyp.ts'

export function Directory() {
  const { user } = useAuth()
  const [raw, setRaw] = useState('')
  const [parsed, setParsed] = useState(null)
  const [parseErr, setParseErr] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [existing, setExisting] = useState([])
  const [loadingExisting, setLoadingExisting] = useState(true)

  const [single, setSingle] = useState({ adminNo: '', name: '', course: NYP_COURSE_CATALOG[0].courses[0] })
  const [addingSingle, setAddingSingle] = useState(false)

  const [students, setStudents] = useState([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const [subjects, setSubjects] = useState([])
  const [sessions, setSessions] = useState([])
  const [matchRequests, setMatchRequests] = useState([])
  const [classRequests, setClassRequests] = useState([])
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [subjectSearch, setSubjectSearch] = useState('')
  const [moderationBusyId, setModerationBusyId] = useState(null)

  const [adminEmails, setAdminEmails] = useState([])
  const [loadingAdminEmails, setLoadingAdminEmails] = useState(true)
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [removingAdmin, setRemovingAdmin] = useState(null)

  async function loadExisting() {
    setLoadingExisting(true)
    try {
      setExisting(await listDirectory())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingExisting(false)
    }
  }

  async function loadStudents() {
    setLoadingStudents(true)
    try {
      setStudents(await listUsers())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingStudents(false)
    }
  }

  async function loadOverview() {
    setLoadingOverview(true)
    try {
      const [allSubjects, allSessions, allMatchRequests, allClassRequests] = await Promise.all([
        listAllTeachingSubjects(),
        listAllSessions(),
        listAllMatchRequests(),
        listClassRequests(),
      ])
      setSubjects(allSubjects)
      setSessions(allSessions)
      setMatchRequests(allMatchRequests)
      setClassRequests(allClassRequests)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingOverview(false)
    }
  }

  async function loadAdminEmails() {
    setLoadingAdminEmails(true)
    try {
      setAdminEmails(await listAdminEmails())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingAdminEmails(false)
    }
  }

  useEffect(() => {
    loadExisting()
    loadStudents()
    loadOverview()
    loadAdminEmails()
  }, [])

  const stats = useMemo(
    () => ({
      users: students.length,
      tutors: new Set(subjects.map((s) => s.userId)).size,
      upcomingSessions: sessions.filter((s) => s.status === 'arranged').length,
      pendingRequests: matchRequests.filter((r) => r.status === 'pending').length,
      openClassRequests: classRequests.filter((r) => r.status !== 'scheduled').length,
    }),
    [students, subjects, sessions, matchRequests, classRequests],
  )
  const loadingStats = loadingStudents || loadingOverview

  const usersById = useMemo(() => Object.fromEntries(students.map((s) => [s.userId, s])), [students])
  const nameFor = (userId) => usersById[userId]?.name || usersById[userId]?.email || 'Unknown'

  async function onCancelMatchRequest(matchId) {
    if (!confirm('Cancel this match request?')) return
    setModerationBusyId(matchId)
    setError('')
    try {
      await cancelMatchRequest(matchId)
      setMatchRequests((prev) => prev.map((r) => (r.matchId === matchId ? { ...r, status: 'rejected' } : r)))
    } catch (err) {
      setError(err.message)
    } finally {
      setModerationBusyId(null)
    }
  }

  async function onDeleteClassRequest(requestId) {
    if (!confirm('Delete this class request? Everyone interested will lose the listing.')) return
    setModerationBusyId(requestId)
    setError('')
    try {
      await deleteClassRequest(requestId)
      setClassRequests((prev) => prev.filter((r) => r.requestId !== requestId))
    } catch (err) {
      setError(err.message)
    } finally {
      setModerationBusyId(null)
    }
  }

  async function onCancelSession(matchId) {
    if (!confirm('Cancel this session?')) return
    setModerationBusyId(matchId)
    setError('')
    try {
      await cancelSession(matchId)
      setSessions((prev) => prev.map((s) => (s.matchId === matchId ? { ...s, status: 'cancelled' } : s)))
    } catch (err) {
      setError(err.message)
    } finally {
      setModerationBusyId(null)
    }
  }

  async function onDeleteSubject(subject) {
    if (!confirm(`Remove ${nameFor(subject.userId)}'s "${subject.moduleName}" listing?`)) return
    setModerationBusyId(subject.id)
    setError('')
    try {
      await deleteTeachingSubject(subject.id)
      setSubjects((prev) => prev.filter((s) => s.id !== subject.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setModerationBusyId(null)
    }
  }

  const filteredSubjects = subjects
    .filter((s) => {
      const q = subjectSearch.trim().toLowerCase()
      if (!q) return true
      return s.moduleName?.toLowerCase().includes(q) || nameFor(s.userId).toLowerCase().includes(q)
    })
    .sort((a, b) => nameFor(a.userId).localeCompare(nameFor(b.userId)))

  async function onAddAdmin(e) {
    e.preventDefault()
    const email = newAdminEmail.trim().toLowerCase()
    if (!email) return
    setAddingAdmin(true)
    setError('')
    try {
      await addAdminEmail(email)
      setAdminEmails((prev) => (prev.includes(email) ? prev : [...prev, email]))
      setNewAdminEmail('')
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingAdmin(false)
    }
  }

  async function onRemoveAdmin(email) {
    if (!confirm(`Remove admin access from ${email}?`)) return
    setRemovingAdmin(email)
    setError('')
    try {
      await removeAdminEmail(email)
      setAdminEmails((prev) => prev.filter((e) => e !== email))
    } catch (err) {
      setError(err.message)
    } finally {
      setRemovingAdmin(null)
    }
  }

  async function saveEdit(userId, patch) {
    setBusyId(userId)
    setError('')
    try {
      await upsertUserProfile(userId, patch)
      setStudents((prev) => prev.map((s) => (s.userId === userId ? { ...s, ...patch } : s)))
      setEditingId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function toggleLock(student) {
    const locked = !student.locked
    if (locked && !confirm(`Lock ${student.name || student.email}? They'll be signed out immediately and can't log back in until unlocked.`)) return
    setBusyId(student.userId)
    setError('')
    try {
      await upsertUserProfile(student.userId, { locked })
      setStudents((prev) => prev.map((s) => (s.userId === student.userId ? { ...s, locked } : s)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function removeStudent(student) {
    if (!confirm(`Delete ${student.name || student.email}'s profile? This can't be undone from here.`)) return
    setBusyId(student.userId)
    setError('')
    try {
      await deleteUserProfile(student.userId)
      setStudents((prev) => prev.filter((s) => s.userId !== student.userId))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const filteredStudents = students
    .filter((s) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (s.name || '').toLowerCase().includes(q) || (s.adminNo || '').toLowerCase().includes(q)
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  function exportCsv() {
    const header = 'Name,Admin No,School,Diploma,Year'
    const rows = filteredStudents.map((s) => {
      const school = s.school || schoolsForCourse(s.course || '')[0] || ''
      return [s.name || '', s.adminNo || '', school, s.course || '', s.year || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'nypkaki-students.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function onText(text) {
    setRaw(text)
    setSuccess('')
    setParseErr('')
    if (!text.trim()) {
      setParsed(null)
      return
    }
    try {
      setParsed(parseStudentDirectory(text))
    } catch (err) {
      setParsed(null)
      setParseErr(err.message)
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onText(String(reader.result))
    reader.readAsText(file)
  }

  async function doImport() {
    if (!parsed?.rows.length) return
    setImporting(true)
    setError('')
    setSuccess('')
    try {
      await importDirectoryRows(parsed.rows)
      setSuccess(`Imported ${parsed.rows.length} student${parsed.rows.length === 1 ? '' : 's'}.`)
      setRaw('')
      setParsed(null)
      await loadExisting()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  async function addSingle(e) {
    e.preventDefault()
    if (!single.adminNo.trim() || !single.name.trim()) return
    setAddingSingle(true)
    setError('')
    try {
      await importDirectoryRows([{ adminNo: single.adminNo.trim().toUpperCase(), name: single.name.trim(), course: single.course }])
      setSingle({ adminNo: '', name: '', course: NYP_COURSE_CATALOG[0].courses[0] })
      await loadExisting()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingSingle(false)
    }
  }

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">ADMIN</p>
          <h1>Admin Page</h1>
          <p className="sub">Import a roster once, and registration auto-fills name + course by admin number.</p>
        </div>
      </div>

      <Banner kind="info">
        Access is limited to the bootstrap admins plus anyone granted below — enforced both here and in the
        Firestore rules, so it holds even if someone finds the URL directly.
      </Banner>

      {loadingStats ? (
        <Spinner />
      ) : stats && (
        <div className="dash-stats admin-stats">
          <div className="dash-stat">
            <div className="dash-stat-icon"><Icon name="user" size={16} /></div>
            <div>
              <b>{stats.users}</b>
              <span>Registered users</span>
            </div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-icon"><Icon name="spark" size={16} /></div>
            <div>
              <b>{stats.tutors}</b>
              <span>Active tutors</span>
            </div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-icon"><Icon name="clock" size={16} /></div>
            <div>
              <b>{stats.upcomingSessions}</b>
              <span>Upcoming sessions</span>
            </div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-icon"><Icon name="inbox" size={16} /></div>
            <div>
              <b>{stats.pendingRequests}</b>
              <span>Pending requests</span>
            </div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-icon"><Icon name="book" size={16} /></div>
            <div>
              <b>{stats.openClassRequests}</b>
              <span>Open class requests</span>
            </div>
          </div>
        </div>
      )}

      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="info">{success}</Banner>}

      <div className="card">
        <h2>Admins</h2>
        <p className="recommend-copy">
          {ADMIN_EMAILS.join(', ')} {ADMIN_EMAILS.length === 1 ? 'is a' : 'are'} hardcoded bootstrap admin
          {ADMIN_EMAILS.length === 1 ? '' : 's'} in <code>src/lib/admin.js</code> and can't be removed here. Anyone
          added below gets the same access, stored in Firestore, without a code deploy.
        </p>

        <form className="search-row" onSubmit={onAddAdmin}>
          <label className="field" style={{ flex: 1, marginRight: 12 }}>
            Grant admin access
            <input
              type="email"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="someone@example.com"
            />
          </label>
          <button className="card-btn inline" type="submit" disabled={addingAdmin || !newAdminEmail.trim()}>
            {addingAdmin ? <Spinner /> : 'Add admin'}
          </button>
        </form>

        {loadingAdminEmails ? (
          <Spinner />
        ) : adminEmails.length === 0 ? (
          <p className="recommend-copy">No additional admins yet.</p>
        ) : (
          <div className="slot-list">
            {adminEmails.map((email) => (
              <div key={email} className="request-mini">
                <div>
                  <b>{email}</b>
                </div>
                <button
                  className="outline"
                  onClick={() => onRemoveAdmin(email)}
                  disabled={removingAdmin === email || email === user?.email?.toLowerCase()}
                  title={email === user?.email?.toLowerCase() ? "Can't remove your own access" : 'Remove admin access'}
                >
                  {removingAdmin === email ? <Spinner /> : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Import a roster</h2>
        <p className="recommend-copy">
          Upload a CSV export (Excel/Sheets: File → Save As / Download → CSV), or paste rows straight from a
          spreadsheet. Needs an "Admin No" and a "Name" column — "Course" is optional.
        </p>

        <label className="field">
          CSV file
          <input type="file" accept=".csv,.txt" onChange={onFile} />
        </label>

        <label className="field">
          Or paste rows here
          <textarea
            value={raw}
            onChange={(e) => onText(e.target.value)}
            placeholder={'Admin No, Name, Course\n231045A, Aaron Tan, Diploma in Computing'}
            style={{ minHeight: 140, fontFamily: 'monospace', fontSize: 12.5 }}
          />
        </label>

        {parseErr && <Banner kind="error">{parseErr}</Banner>}

        {parsed && (
          <>
            <p className="recommend-copy">
              Found {parsed.rows.length} student{parsed.rows.length === 1 ? '' : 's'}
              {parsed.skipped ? ` (skipped ${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} missing admin no. or name)` : ''}.
            </p>
            {parsed.rows.length > 0 && (
              <div className="slot-list" style={{ maxHeight: 220, overflow: 'auto' }}>
                {parsed.rows.slice(0, 8).map((r) => (
                  <div key={r.adminNo} className="request-mini">
                    <div>
                      <b>{r.name}</b>
                      <small>
                        {r.adminNo} {r.course ? `· ${r.course}` : ''}
                      </small>
                    </div>
                  </div>
                ))}
                {parsed.rows.length > 8 && <p className="recommend-copy">…and {parsed.rows.length - 8} more.</p>}
              </div>
            )}
            <button className="primary" onClick={doImport} disabled={importing || !parsed.rows.length}>
              {importing ? <Spinner /> : <>Import {parsed.rows.length} student{parsed.rows.length === 1 ? '' : 's'} <Icon name="arrow" size={16} /></>}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2>Add one student</h2>
        <form onSubmit={addSingle}>
          <div className="form-grid">
            <label className="field">
              Admin number
              <input required value={single.adminNo} onChange={(e) => setSingle((s) => ({ ...s, adminNo: e.target.value }))} placeholder="231045A" />
            </label>
            <label className="field">
              Name
              <input required value={single.name} onChange={(e) => setSingle((s) => ({ ...s, name: e.target.value }))} placeholder="Aaron Tan" />
            </label>
          </div>
          <label className="field">
            Course
            <select value={single.course} onChange={(e) => setSingle((s) => ({ ...s, course: e.target.value }))}>
              {NYP_COURSE_CATALOG.map(({ school, courses }) => (
                <optgroup key={school} label={school}>
                  {courses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="primary" type="submit" disabled={addingSingle}>
            {addingSingle ? <Spinner /> : 'Add student'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Registered students ({loadingStudents ? '…' : students.length})</h2>
        <p className="recommend-copy">
          Everyone who has actually signed up, not the imported roster below. Edit/lock/delete only touch this
          Firestore profile — there's no backend here to delete or disable the actual login, so a locked or deleted
          account is signed out and blocked the moment it's checked, but the credentials themselves still exist.
        </p>

        <div className="search-row">
          <label className="field" style={{ flex: 1, marginRight: 12 }}>
            Search by name or admin number
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Aaron or 231045A" />
          </label>
          <button className="card-btn inline export-btn" onClick={exportCsv} disabled={!filteredStudents.length}>
            <Icon name="download" size={14} /> Export CSV
          </button>
        </div>

        {loadingStudents ? (
          <Spinner />
        ) : students.length === 0 ? (
          <p className="recommend-copy">No one has registered yet.</p>
        ) : filteredStudents.length === 0 ? (
          <p className="recommend-copy">No students match "{search}".</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Admin No</th>
                  <th>School</th>
                  <th>Diploma</th>
                  <th>Year</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => (
                  <StudentRow
                    key={s.userId}
                    student={s}
                    editing={editingId === s.userId}
                    busy={busyId === s.userId}
                    onEdit={() => setEditingId(s.userId)}
                    onCancelEdit={() => setEditingId(null)}
                    onSave={(patch) => saveEdit(s.userId, patch)}
                    onToggleLock={() => toggleLock(s)}
                    onDelete={() => removeStudent(s)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Moderation</h2>
        <p className="recommend-copy">
          Every match request, class request, and session platform-wide. There's no delete endpoint for match
          requests (AWS-backed), so "Cancel" rejects it the same way a tutor declining would.
        </p>

        {loadingOverview ? (
          <Spinner />
        ) : (
          <>
            <h3 className="mod-subheading">Match requests ({matchRequests.filter((r) => r.status === 'pending' || r.status === 'accepted').length} active)</h3>
            {matchRequests.filter((r) => r.status === 'pending' || r.status === 'accepted').length === 0 ? (
              <p className="recommend-copy">None active.</p>
            ) : (
              <div className="slot-list">
                {matchRequests
                  .filter((r) => r.status === 'pending' || r.status === 'accepted')
                  .map((r) => (
                    <div key={r.matchId} className="request-mini">
                      <div>
                        <b>{r.moduleName}</b>
                        <small>
                          {nameFor(r.studentId)} → {nameFor(r.tutorId)} · {r.status}
                        </small>
                      </div>
                      <button
                        className="outline"
                        onClick={() => onCancelMatchRequest(r.matchId)}
                        disabled={moderationBusyId === r.matchId}
                      >
                        {moderationBusyId === r.matchId ? <Spinner /> : 'Cancel'}
                      </button>
                    </div>
                  ))}
              </div>
            )}

            <h3 className="mod-subheading">Class requests ({classRequests.filter((r) => r.status !== 'scheduled').length} open)</h3>
            {classRequests.filter((r) => r.status !== 'scheduled').length === 0 ? (
              <p className="recommend-copy">None open.</p>
            ) : (
              <div className="slot-list">
                {classRequests
                  .filter((r) => r.status !== 'scheduled')
                  .map((r) => (
                    <div key={r.requestId} className="request-mini">
                      <div>
                        <b>{r.moduleName}</b>
                        <small>Requested by {r.studentName}</small>
                      </div>
                      <button
                        className="outline"
                        onClick={() => onDeleteClassRequest(r.requestId)}
                        disabled={moderationBusyId === r.requestId}
                      >
                        {moderationBusyId === r.requestId ? <Spinner /> : 'Delete'}
                      </button>
                    </div>
                  ))}
              </div>
            )}

            <h3 className="mod-subheading">Sessions ({sessions.filter((s) => s.status === 'arranged').length} upcoming)</h3>
            {sessions.filter((s) => s.status === 'arranged').length === 0 ? (
              <p className="recommend-copy">None upcoming.</p>
            ) : (
              <div className="slot-list">
                {sessions
                  .filter((s) => s.status === 'arranged')
                  .map((s) => (
                    <div key={s.matchId} className="request-mini">
                      <div>
                        <b>{s.day} · {s.startTime}–{s.endTime}</b>
                        <small>{s.location} · {s.format}</small>
                      </div>
                      <button
                        className="outline"
                        onClick={() => onCancelSession(s.matchId)}
                        disabled={moderationBusyId === s.matchId}
                      >
                        {moderationBusyId === s.matchId ? <Spinner /> : 'Cancel'}
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Teaching subjects ({loadingOverview ? '…' : subjects.length})</h2>
        <p className="recommend-copy">Every tutor listing platform-wide. Remove a bad or duplicate entry without touching the tutor's account.</p>

        <label className="field">
          Search by module or tutor
          <input value={subjectSearch} onChange={(e) => setSubjectSearch(e.target.value)} placeholder="e.g. Databases or Aaron" />
        </label>

        {loadingOverview ? (
          <Spinner />
        ) : filteredSubjects.length === 0 ? (
          <p className="recommend-copy">No listings match.</p>
        ) : (
          <div className="slot-list" style={{ maxHeight: 320, overflow: 'auto' }}>
            {filteredSubjects.map((s) => (
              <div key={s.id} className="request-mini">
                <div>
                  <b>{s.moduleName}</b>
                  <small>{nameFor(s.userId)} · confidence {s.confidence ?? '—'}</small>
                </div>
                <button className="outline" onClick={() => onDeleteSubject(s)} disabled={moderationBusyId === s.id}>
                  {moderationBusyId === s.id ? <Spinner /> : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Directory ({loadingExisting ? '…' : existing.length})</h2>
        {loadingExisting ? (
          <Spinner />
        ) : existing.length === 0 ? (
          <p className="recommend-copy">No students imported yet.</p>
        ) : (
          <div className="slot-list" style={{ maxHeight: 320, overflow: 'auto' }}>
            {existing
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <div key={s.adminNo} className="request-mini">
                  <div>
                    <b>{s.name}</b>
                    <small>
                      {s.adminNo} {s.course ? `· ${s.course}` : ''}
                    </small>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </>
  )
}

function StudentRow({ student, editing, busy, onEdit, onCancelEdit, onSave, onToggleLock, onDelete }) {
  const [draft, setDraft] = useState(null)

  function startEdit() {
    setDraft({
      name: student.name || '',
      adminNo: student.adminNo || '',
      course: student.course || NYP_COURSE_CATALOG[0].courses[0],
      year: student.year || 2,
    })
    onEdit()
  }

  if (editing && draft) {
    return (
      <tr>
        <td>
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </td>
        <td>
          <input value={draft.adminNo} onChange={(e) => setDraft((d) => ({ ...d, adminNo: e.target.value.toUpperCase() }))} />
        </td>
        <td className="muted-cell">{schoolsForCourse(draft.course)[0] || '—'}</td>
        <td>
          <select value={draft.course} onChange={(e) => setDraft((d) => ({ ...d, course: e.target.value }))}>
            {NYP_COURSE_CATALOG.map(({ school, courses }) => (
              <optgroup key={school} label={school}>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </td>
        <td>
          <select value={draft.year} onChange={(e) => setDraft((d) => ({ ...d, year: Number(e.target.value) }))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </td>
        <td>
          <div className="row-actions">
            <button
              className="row-action save"
              onClick={() => onSave({ ...draft, school: schoolsForCourse(draft.course)[0] || '' })}
              disabled={busy}
              title="Save"
            >
              {busy ? <Spinner /> : <Icon name="check" size={14} />}
            </button>
            <button className="row-action" onClick={onCancelEdit} disabled={busy} title="Cancel">
              <Icon name="x" size={14} />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>
        {student.name || <span className="muted-cell">Not set</span>}
        {student.locked && <span className="lock-tag">Locked</span>}
      </td>
      <td>{student.adminNo || <span className="muted-cell">—</span>}</td>
      <td>{student.school || schoolsForCourse(student.course || '')[0] || <span className="muted-cell">—</span>}</td>
      <td>{student.course || <span className="muted-cell">Not set</span>}</td>
      <td>{student.year || <span className="muted-cell">—</span>}</td>
      <td>
        <div className="row-actions">
          <button className="row-action" onClick={startEdit} disabled={busy} title="Edit">
            <Icon name="edit" size={14} />
          </button>
          <button className="row-action" onClick={onToggleLock} disabled={busy} title={student.locked ? 'Unlock' : 'Lock'}>
            {busy ? <Spinner /> : <Icon name={student.locked ? 'unlock' : 'lock'} size={14} />}
          </button>
          <button className="row-action danger" onClick={onDelete} disabled={busy} title="Delete">
            <Icon name="trash" size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}
