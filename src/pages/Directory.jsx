import { useEffect, useState } from 'react'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { Icon } from '../components/Icon.jsx'
import { deleteUserProfile, importDirectoryRows, listDirectory, listUsers, upsertUserProfile } from '../lib/firestore.js'
import { parseStudentDirectory } from '../lib/csv.js'
import { NYP_COURSE_CATALOG, schoolsForCourse } from '../shared/nyp.ts'

export function Directory() {
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

  useEffect(() => {
    loadExisting()
    loadStudents()
  }, [])

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
    a.download = 'peerlink-students.csv'
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
        This page isn't linked from the sidebar and isn't access-controlled yet — anyone signed in who has the URL can
        import. Fine for getting a roster loaded now; worth locking down before relying on it for real.
      </Banner>

      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="info">{success}</Banner>}

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
