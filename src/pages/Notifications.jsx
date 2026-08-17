import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Icon } from '../components/Icon.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
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

export function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { items, loading } = useNotifications(user.userId)

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">NOTIFICATIONS</p>
          <h1>Everything, in one feed</h1>
          <p className="sub">Match requests, accepted tutoring, and scheduled classes.</p>
        </div>
      </div>

      {loading ? (
        <AppLoader compact />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🔔</span>
          <p>Nothing yet — you'll see match requests, accepted tutoring, and scheduled classes here.</p>
        </div>
      ) : (
        <div className="notif-feed">
          {items.map((item) => (
            <button key={item.id} className="notif-feed-item" onClick={() => navigate(item.href)}>
              <span className="notify-item-icon">
                <Icon name={item.icon} size={16} />
              </span>
              <span className="notify-item-body">
                <span>{item.text}</span>
                <small>{timeAgo(item.createdAt)}</small>
              </span>
              <Icon name="chevron" size={15} />
            </button>
          ))}
        </div>
      )}
    </>
  )
}
