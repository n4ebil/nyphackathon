import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Icon } from './Icon.jsx'
import { Spinner } from './Spinner.jsx'
import { useNotifications } from '../lib/useNotifications.js'

function timeAgo(iso) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { items, unseenCount, loading, reload, markSeen } = useNotifications(user.userId)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onClickAway(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) markSeen()
    else reload()
  }

  function goTo(item) {
    setOpen(false)
    navigate(item.href)
  }

  return (
    <div className="notify-wrap" ref={wrapRef}>
      <button className="notify" onClick={toggleOpen} title="Notifications">
        <Icon name="bell" size={20} />
        {unseenCount > 0 && <i />}
      </button>
      {open && (
        <div className="notify-panel">
          <div className="notify-panel-head">
            <b>Notifications</b>
          </div>
          {loading ? (
            <div className="notify-empty">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <div className="notify-empty">
              <span className="empty-icon">🔔</span>
              <p>Nothing yet — you'll see match requests, accepted tutoring, and scheduled classes here.</p>
            </div>
          ) : (
            <div className="notify-list">
              {items.slice(0, 6).map((item) => (
                <button key={item.id} className="notify-item" onClick={() => goTo(item)}>
                  <span className="notify-item-icon">
                    <Icon name={item.icon} size={15} />
                  </span>
                  <span className="notify-item-body">
                    <span>{item.text}</span>
                    <small>{timeAgo(item.createdAt)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <button className="notify-panel-foot" onClick={() => { setOpen(false); navigate('/notifications') }}>
            View all notifications
          </button>
        </div>
      )}
    </div>
  )
}
