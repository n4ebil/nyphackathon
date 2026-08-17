/**
 * Notifications are computed on the fly from data that already exists —
 * match requests, class requests, interests, teaching subjects — rather than
 * a dedicated collection. No new collection means no new Firestore rules to
 * deploy before this works; it's live the moment the code ships.
 *
 * "Seen" state lives in localStorage per user, since there's no backend to
 * track it server-side. That's a real trade-off (doesn't sync across
 * devices) but keeps this simple and dependency-free.
 */

const SEEN_KEY_PREFIX = 'nypkaki-seen-notifications-'
const CLASS_READY_THRESHOLD = 3

export function computeNotifications({ userId, matchRequests, classRequests, classInterests, teachingSubjects }) {
  const items = []
  const { incoming = [], outgoing = [] } = matchRequests || {}

  for (const r of incoming.filter((r) => r.status === 'pending')) {
    items.push({
      id: `match-in-${r.matchId}`,
      icon: 'message',
      text: `Someone requested tutoring for ${r.moduleName}`,
      href: '/requests',
      createdAt: r.createdAt,
    })
  }

  for (const r of outgoing.filter((r) => r.status === 'accepted')) {
    items.push({
      id: `match-out-${r.matchId}`,
      icon: 'check',
      text: `Your tutoring request for ${r.moduleName} was accepted`,
      href: '/requests',
      createdAt: r.createdAt,
    })
  }

  const myInterestIds = new Set(classInterests.filter((i) => i.userId === userId).map((i) => i.requestId))
  for (const req of classRequests) {
    const involved = req.studentId === userId || myInterestIds.has(req.requestId)
    if (req.status === 'scheduled' && involved && req.teacherId !== userId) {
      items.push({
        id: `class-scheduled-${req.requestId}`,
        icon: 'book',
        text: `${req.teacherName} is teaching ${req.moduleName} — you're on the list`,
        href: '/schedule',
        createdAt: req.date ? `${req.date}T${req.startTime || '00:00'}` : req.createdAt,
      })
    }
  }

  const myModules = new Set(teachingSubjects.filter((s) => s.userId === userId).map((s) => s.moduleId))
  if (myModules.size) {
    for (const req of classRequests) {
      if (req.status === 'scheduled' || !myModules.has(req.moduleId)) continue
      const count = classInterests.filter((i) => i.requestId === req.requestId).length
      if (count >= CLASS_READY_THRESHOLD) {
        items.push({
          id: `class-ready-${req.requestId}`,
          icon: 'spark',
          text: `${count} students want help with ${req.moduleName} — you teach this`,
          href: '/schedule',
          createdAt: req.createdAt,
        })
      }
    }
  }

  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return items
}

function seenKey(userId) {
  return `${SEEN_KEY_PREFIX}${userId}`
}

export function getSeenIds(userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey(userId)) || '[]'))
  } catch {
    return new Set()
  }
}

export function markAllSeen(userId, notificationIds) {
  try {
    const existing = getSeenIds(userId)
    notificationIds.forEach((id) => existing.add(id))
    localStorage.setItem(seenKey(userId), JSON.stringify([...existing]))
  } catch {
    // localStorage unavailable (private browsing etc.) — notifications just won't persist read state.
  }
}
