import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import { AppLoader } from '../components/AppLoader.jsx'

export function Login() {
  const { user, loading, configured, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <AppLoader />
  if (user) return <Navigate to="/dashboard" replace />

  function onEmailBlur() {
    const value = email.trim()
    if (value && !value.includes('@')) {
      setEmail(`${value.toLowerCase()}@mymail.nyp.edu.sg`)
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand">
          <img className="brand-mark" src="/icon1.svg" alt="NYPkaki" />
          <span>
            NYP<span>kaki</span>
          </span>
        </div>
        <h1>Welcome back</h1>
        <p className="sub">Sign in to find or offer tutoring.</p>

        {!configured && (
          <Banner kind="warn">
            Firebase isn't connected yet. Add your project config to <code>.env.local</code> (see{' '}
            <code>.env.example</code>) to enable sign-in.
          </Banner>
        )}
        {error && <Banner kind="error">{error}</Banner>}

        <form onSubmit={onSubmit}>
          <label className="field">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={onEmailBlur}
              placeholder="you@mymail.nyp.edu.sg or admin number"
              disabled={!configured}
            />
          </label>
          <label className="field">
            Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" disabled={!configured} />
          </label>
          <button className="primary wide" type="submit" disabled={!configured || busy}>
            {busy ? <Spinner /> : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          New to NYPkaki? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  )
}
