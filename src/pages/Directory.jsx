import { useEffect, useState } from 'react'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { Icon } from '../components/Icon.jsx'
import { importDirectoryRows, listDirectory } from '../lib/firestore.js'
import { parseStudentDirectory } from '../lib/csv.js'
import { NYP_COURSE_CATALOG } from '../shared/nyp.ts'

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

  useEffect(() => {
    loadExisting()
  }, [])

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
          <h1>Student directory</h1>
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
