import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { Icon } from '../components/Icon.jsx'
import { lookupStudent } from '../lib/firestore.js'
import { NYP_COURSE_CATALOG, schoolsForCourse } from '../shared/nyp.ts'

export function Register() {
  const { user, loading, configured, register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    adminNo: '',
    email: '',
    school: NYP_COURSE_CATALOG[0].school,
    course: NYP_COURSE_CATALOG[0].courses[0],
    year: 2,
    bio: '',
    preferredFormat: 'either',
    password: '',
    confirm: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [directoryStatus, setDirectoryStatus] = useState('') // '' | 'checking' | 'found' | 'not-found'

  if (loading) {
    return (
      <div className="app-loading">
        <Spinner />
      </div>
    )
  }
  if (user) return <Navigate to="/dashboard" replace />

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  function onAdminNoChange(e) {
    const adminNo = e.target.value
    setDirectoryStatus('')
    setForm((f) => ({
      ...f,
      adminNo,
      email: f.email && f.email !== suggestedEmail(f.adminNo) ? f.email : suggestedEmail(adminNo),
    }))
  }

  function selectSchool(e) {
    const school = e.target.value
    const course = NYP_COURSE_CATALOG.find((group) => group.school === school)?.courses[0] || ''
    setForm((f) => ({ ...f, school, course }))
  }

  async function onAdminNoBlur() {
    const adminNo = form.adminNo.trim()
    if (!adminNo || !configured) return
    setDirectoryStatus('checking')
    try {
      const match = await lookupStudent(adminNo)
      if (match) {
        setForm((f) => ({
          ...f,
          name: match.name || f.name,
          course: match.course || f.course,
          school: match.course ? schoolsForCourse(match.course)[0] || f.school : f.school,
          year: match.year || f.year,
        }))
        setDirectoryStatus('found')
      } else {
        setDirectoryStatus('not-found')
      }
    } catch {
      setDirectoryStatus('not-found')
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) return setError('Password should be at least 6 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
        adminNo: form.adminNo.trim().toUpperCase(),
        school: form.school,
        course: form.course,
        year: Number(form.year),
        bio: form.bio.trim(),
        preferredFormat: form.preferredFormat,
      })
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card wide">
        <div className="brand">
          <div className="brand-mark">N</div>
          <span>
            NYP<span>kaki</span>
          </span>
        </div>
        <h1>Create your account</h1>
        <p className="sub">Tell us a bit about yourself so we can match you well.</p>

        {!configured && (
          <Banner kind="warn">
            Firebase isn't connected yet. Add your project config to <code>.env.local</code> to enable registration.
          </Banner>
        )}
        {error && <Banner kind="error">{error}</Banner>}

        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label className="field">
              Full name
              <input required value={form.name} onChange={set('name')} placeholder="Jamie Tan" disabled={!configured} />
            </label>
            <label className="field">
              Admin number
              <input
                required
                value={form.adminNo}
                onChange={onAdminNoChange}
                onBlur={onAdminNoBlur}
                placeholder="231045A"
                disabled={!configured}
              />
              {directoryStatus === 'checking' && (
                <span className="directory-hint">
                  <Spinner /> Checking…
                </span>
              )}
              {directoryStatus === 'found' && (
                <span className="directory-hint found">
                  <Icon name="check" size={13} /> Found — name and course filled in
                </span>
              )}
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              School
              <select value={form.school} onChange={selectSchool} disabled={!configured}>
                {NYP_COURSE_CATALOG.map(({ school }) => <option key={school} value={school}>{school}</option>)}
              </select>
            </label>
            <label className="field">
              Course
              <select value={form.course} onChange={set('course')} disabled={!configured}>
                {(NYP_COURSE_CATALOG.find((group) => group.school === form.school)?.courses || []).map((course) => (
                  <option key={course} value={course}>{course}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              Year of study
              <select value={form.year} onChange={set('year')} disabled={!configured}>
                <option value={1}>Year 1</option>
                <option value={2}>Year 2</option>
                <option value={3}>Year 3</option>
              </select>
            </label>
          </div>

          <label className="field">
            Email
            <input type="email" required value={form.email} onChange={set('email')} placeholder="you@mymail.nyp.edu.sg" disabled={!configured} />
          </label>

          <label className="field">
            Preferred session format
            <select value={form.preferredFormat} onChange={set('preferredFormat')} disabled={!configured}>
              <option value="in-person">In-person</option>
              <option value="online">Online</option>
              <option value="either">Either</option>
            </select>
          </label>

          <label className="field">
            Short bio
            <textarea value={form.bio} onChange={set('bio')} placeholder="What are you studying and what do you need help with?" disabled={!configured} />
          </label>

          <div className="form-grid">
            <label className="field">
              Password
              <input type="password" required value={form.password} onChange={set('password')} placeholder="••••••••" disabled={!configured} />
            </label>
            <label className="field">
              Confirm password
              <input type="password" required value={form.confirm} onChange={set('confirm')} placeholder="••••••••" disabled={!configured} />
            </label>
          </div>

          <button className="primary wide" type="submit" disabled={!configured || busy}>
            {busy ? <Spinner /> : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

function suggestedEmail(adminNo) {
  return adminNo ? `${adminNo.trim().toLowerCase()}@mymail.nyp.edu.sg` : ''
}
