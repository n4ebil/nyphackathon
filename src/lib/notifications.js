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
// How far ahead a "starting soon" reminder lights up — mirrors the Cloud Functions email reminder window.
const REMINDER_WINDOW_HOURS = 1
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Wed" + "14:00" -> the next real calendar date/time that combination lands on, in the browser's local time. */
function nextOccurrence(day, time) {
  const targetDow = WEEKDAYS.indexOf(day)
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const delta = (targetDow - now.getDay() + 7) % 7
  const candidate = new Date(now)
  candidate.setDate(candidate.getDate() + delta)
  candidate.setHours(h, m, 0, 0)
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7)
  return candidate
}

function minutesAwayText(hoursAway) {
  const mins = Math.round(hoursAway * 60)
  return mins <= 1 ? 'starting now' : `starts in about ${mins} min`
}

export function computeNotifications({ userId, matchRequests, classRequests, classInterests, teachingSubjects, learningRequests, sessions }) {
  const items = []
  const { incoming = [], outgoing = [] } = matchRequests || {}
  const matchById = Object.fromEntries([...incoming, ...outgoing].map((r) => [r.matchId, r]))

  for (const r of incoming.filter((r) => r.status === 'pending')) {
    items.push({
      id: `match-in-${r.matchId}`,
      icon: 'message',
      text: `Someone requested tutoring for ${r.moduleName}`,
      href: '/requests',
      createdAt: r.createdAt,
    })
  }

  // The requester's own confirmation that their request went out — mirrors the "request received" one above.
  for (const r of outgoing.filter((r) => r.status === 'pending')) {
    items.push({
      id: `match-sent-${r.matchId}`,
      icon: 'message',
      text: `Your request for ${r.moduleName} was sent — waiting on a reply`,
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

  // A confirmed 1:1 session — for whichever side (tutor or student) is looking.
  for (const s of sessions || []) {
    const match = matchById[s.matchId]
    if (!match || s.status !== 'arranged') continue
    items.push({
      id: `session-confirmed-${s.matchId}`,
      icon: 'check',
      text: `Your ${match.moduleName} session is confirmed — ${s.day} ${s.startTime}–${s.endTime}`,
      href: '/sessions',
      createdAt: match.createdAt,
    })
    const hoursAway = (nextOccurrence(s.day, s.startTime).getTime() - Date.now()) / 3_600_000
    if (hoursAway > 0 && hoursAway <= REMINDER_WINDOW_HOURS) {
      items.push({
        id: `session-reminder-${s.matchId}`,
        icon: 'bell',
        text: `Your ${match.moduleName} session ${minutesAwayText(hoursAway)}`,
        href: '/sessions',
        createdAt: new Date().toISOString(),
      })
    }
  }

  const myInterestIds = new Set(classInterests.filter((i) => i.userId === userId).map((i) => i.requestId))
  for (const req of classRequests) {
    const involved = req.studentId === userId || myInterestIds.has(req.requestId)

    // The requester's own confirmation their class request went out, while it's still collecting interest.
    if (req.status !== 'scheduled' && req.studentId === userId) {
      const count = classInterests.filter((i) => i.requestId === req.requestId).length
      items.push({
        id: `class-open-${req.requestId}`,
        icon: 'message',
        text: `Your request for ${req.moduleName} was posted — ${count} interested so far`,
        href: '/schedule',
        createdAt: req.createdAt,
      })
    }

    if (req.status === 'scheduled' && involved && req.teacherId !== userId) {
      items.push({
        id: `class-scheduled-${req.requestId}`,
        icon: 'book',
        text: `${req.teacherName} is teaching ${req.moduleName} — you're on the list`,
        href: '/schedule',
        createdAt: req.date ? `${req.date}T${req.startTime || '00:00'}` : req.createdAt,
      })
    }

    if (req.status === 'scheduled' && involved && req.date) {
      const hoursAway = (new Date(`${req.date}T${req.startTime || '00:00'}:00`).getTime() - Date.now()) / 3_600_000
      if (hoursAway > 0 && hoursAway <= REMINDER_WINDOW_HOURS) {
        items.push({
          id: `class-reminder-${req.requestId}`,
          icon: 'bell',
          text: `${req.moduleName} with ${req.teacherName} ${minutesAwayText(hoursAway)}`,
          href: '/schedule',
          createdAt: new Date().toISOString(),
        })
      }
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

  // "Waitlist" — a student's own past request that had no tutor at the time,
  // where someone has since started teaching that competency. Computed live
  // from existing data, not a stored flag, so it needs no new collection.
  const myRequests = (learningRequests || []).filter((r) => r.userId === userId)
  const alreadyRequestedModules = new Set(outgoing.map((r) => r.moduleName))
  const notifiedModules = new Set()
  for (const req of myRequests) {
    if (notifiedModules.has(req.moduleId) || alreadyRequestedModules.has(req.moduleName)) continue
    const nowTeaching = teachingSubjects.find((s) => s.moduleId === req.moduleId && s.userId !== userId)
    if (!nowTeaching) continue
    notifiedModules.add(req.moduleId)
    items.push({
      id: `waitlist-${req.moduleId}`,
      icon: 'spark',
      text: `Someone now teaches ${req.moduleName} — you asked about this before`,
      href: '/dashboard',
      createdAt: req.createdAt,
    })
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
