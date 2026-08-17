import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Icon } from './Icon.jsx'
import { Spinner } from './Spinner.jsx'
import { listAllClassInterests, listAllTeachingSubjects, listClassRequests, listMatchRequests } from '../lib/firestore.js'
import { computeNotifications, getSeenIds, markAllSeen } from '../lib/notifications.js'

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
  const [items, setItems] = useState([])
  const [unseenCount, setUnseenCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const wrapRef = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const [matchRequests, classRequests, classInterests, teachingSubjects] = await Promise.all([
        listMatchRequests(user.userId),
        listClassRequests(),
        listAllClassInterests(),
        listAllTeachingSubjects(),
      ])
      const computed = computeNotifications({ userId: user.userId, matchRequests, classRequests, classInterests, teachingSubjects })
      const seen = getSeenIds(user.userId)
      setItems(computed)
      setUnseenCount(computed.filter((n) => !seen.has(n.id)).length)
    } catch (err) {
      console.error('Could not load notifications.', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.userId])

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
    if (next) {
      markAllSeen(user.userId, items.map((n) => n.id))
      setUnseenCount(0)
    } else {
      load()
    }
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
              {items.map((item) => (
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
        </div>
      )}
    </div>
  )
}
