import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { NYP_COURSE_CATALOG } from '../shared/nyp.ts'

export function Register() {
  const { user, loading, configured, register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    adminNo: '',
    email: '',
    course: NYP_COURSE_CATALOG[0].courses[0],
    year: 2,
    bio: '',
    preferredFormat: 'either',
    password: '',
    confirm: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    setForm((f) => ({
      ...f,
      adminNo,
      email: f.email && f.email !== suggestedEmail(f.adminNo) ? f.email : suggestedEmail(adminNo),
    }))
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
          <div className="brand-mark">P</div>
          <span>
            peer<span>link</span>
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
              <input required value={form.adminNo} onChange={onAdminNoChange} placeholder="231045A" disabled={!configured} />
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              Course
              <select value={form.course} onChange={set('course')} disabled={!configured}>
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
