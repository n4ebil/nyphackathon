import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Icon } from './Icon.jsx'
import { Avatar } from './Avatar.jsx'
import { NotificationBell } from './NotificationBell.jsx'
import { listMatchRequests } from '../lib/firestore.js'

const NAV_ITEMS = [
  ['/dashboard', 'Home', 'home'],
  ['/find-tutors', 'Find Tutors', 'search'],
  ['/requests', 'Requests', 'inbox'],
  ['/sessions', 'Sessions', 'calendar'],
  ['/messages', 'Messages', 'message'],
]

const MOBILE_NAV = [
  ['/dashboard', 'Home', 'home'],
  ['/find-tutors', 'Find', 'search'],
  ['/requests', 'Requests', 'inbox'],
  ['/sessions', 'Sessions', 'calendar'],
  ['/profile', 'Profile', 'user'],
]

export function Layout() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    listMatchRequests(user.userId)
      .then((result) => {
        if (cancelled) return
        setPendingCount(result.incoming.filter((r) => r.status === 'pending').length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user.userId])

  const badges = { '/requests': pendingCount }

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <img className="brand-mark" src="/icon1.svg" alt="NYPkaki" />
          <span>
            NYP<span>kaki</span>
          </span>
        </div>
        <nav>
          <div className="nav-group">
            {NAV_ITEMS.map(([to, label, icon]) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name={icon} />
                {label}
                {badges[to] > 0 && <i className="nav-badge">{badges[to] > 9 ? '9+' : badges[to]}</i>}
              </NavLink>
            ))}
          </div>

          {isAdmin && (
            <div className="nav-group">
              <NavLink to="/admin/directory" className={({ isActive }) => 'nav-admin' + (isActive ? ' active' : '')}>
                <Icon name="user" />
                Admin Page
              </NavLink>
            </div>
          )}
        </nav>
        <div className="side-bottom">
          <button className="tutor-mode" onClick={() => navigate('/profile#teaching')}>
            <span>
              <Icon name="plus" size={16} />
            </span>
            Become a Tutor
          </button>
          <div className="user-row">
            <NavLink to="/profile" className={({ isActive }) => `profile-link${isActive ? ' active' : ''}`}>
              <Avatar name={user?.name || user?.email} id={user?.userId} small />
              <div>
                <b>{user?.name || 'Your profile'}</b>
                <small>{user?.course || user?.email}</small>
              </div>
            </NavLink>
            <button className="more" title="Sign out" onClick={logout}>
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="mobile-brand">
            <img className="brand-mark" src="/icon1.svg" alt="NYPkaki" />
            NYP<span>kaki</span>
          </div>
          <div className="header-actions">
            <NotificationBell />
            <button className="avatar small self" onClick={() => navigate('/profile')}>
              {(user?.name || user?.email || '?')[0]?.toUpperCase()}
            </button>
          </div>
        </header>
        <section className="content">
          <Outlet />
        </section>
      </main>
      <nav className="mobile-tabbar">
        {MOBILE_NAV.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={icon} size={19} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
