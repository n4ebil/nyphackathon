import { useEffect, useState } from 'react'
import {
  listAllClassInterests,
  listAllLearningRequests,
  listAllSessions,
  listAllTeachingSubjects,
  listClassRequests,
  listMatchRequests,
} from './firestore.js'
import { computeNotifications, getSeenIds, markAllSeen } from './notifications.js'

/** Shared by the header bell and the full Notifications page, so both read the same computed list. */
export function useNotifications(userId) {
  const [items, setItems] = useState([])
  const [unseenCount, setUnseenCount] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [matchRequests, classRequests, classInterests, teachingSubjects, learningRequests, sessions] = await Promise.all([
        listMatchRequests(userId),
        listClassRequests(),
        listAllClassInterests(),
        listAllTeachingSubjects(),
        listAllLearningRequests(),
        listAllSessions(),
      ])
      const computed = computeNotifications({ userId, matchRequests, classRequests, classInterests, teachingSubjects, learningRequests, sessions })
      const seen = getSeenIds(userId)
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
  }, [userId])

  function markSeen() {
    markAllSeen(userId, items.map((n) => n.id))
    setUnseenCount(0)
  }

  return { items, unseenCount, loading, reload: load, markSeen }
}
