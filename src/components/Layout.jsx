import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Icon } from './Icon.jsx'
import { Avatar } from './Avatar.jsx'

const NAV = [
  ['/dashboard', 'Dashboard', 'home'],
  ['/requests', 'My sessions', 'calendar'],
  ['/schedule', 'Schedule', 'book'],
]

export function Layout() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const nav = isAdmin ? [...NAV, ['/admin/directory', 'Admin Page', 'user']] : NAV

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <div className="brand-mark">N</div>
          <span>
            NYP<span>kaki</span>
          </span>
        </div>
        <nav>
          <p className="nav-heading">Workspace</p>
          {nav.map(([to, label, icon]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={icon} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="side-bottom">
          <button className="tutor-mode" onClick={() => navigate('/profile#teaching')}>
            <span>
              <Icon name="plus" size={16} />
            </span>
            Become a tutor
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
            <div className="brand-mark">N</div>
            NYP<span>kaki</span>
          </div>
          <div className="header-actions">
            <button className="notify">
              <Icon name="bell" size={20} />
            </button>
            <button className="avatar small self" onClick={() => navigate('/profile')}>
              {(user?.name || user?.email || '?')[0]?.toUpperCase()}
            </button>
          </div>
        </header>
        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
