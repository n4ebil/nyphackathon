const { defineSecret } = require('firebase-functions/params')

const ZOOM_ACCOUNT_ID = defineSecret('ZOOM_ACCOUNT_ID')
const ZOOM_CLIENT_ID = defineSecret('ZOOM_CLIENT_ID')
const ZOOM_CLIENT_SECRET = defineSecret('ZOOM_CLIENT_SECRET')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

let cachedToken = null // { token, expiresAt }

/** Server-to-Server OAuth — Zoom's recommended flow for app-to-app calls with no end-user login. Token is valid ~1hr; cached across warm function invocations. */
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token

  const basic = Buffer.from(`${ZOOM_CLIENT_ID.value()}:${ZOOM_CLIENT_SECRET.value()}`).toString('base64')
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID.value()}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  })
  if (!res.ok) throw new Error(`Zoom OAuth failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cachedToken.token
}

/** "Wed" + "14:00" -> the next real calendar date/time that combination lands on, as a JS Date (Singapore time). */
function nextOccurrence(day, time) {
  const targetDow = WEEKDAYS.indexOf(day)
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const nowSgt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }))
  let delta = (targetDow - nowSgt.getDay() + 7) % 7
  const candidate = new Date(nowSgt)
  candidate.setDate(candidate.getDate() + delta)
  candidate.setHours(h, m, 0, 0)
  if (candidate.getTime() <= nowSgt.getTime()) candidate.setDate(candidate.getDate() + 7)
  return candidate
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

/**
 * Creates a real, unique scheduled Zoom meeting for one tutoring session.
 * Returns { joinUrl, startUrl, meetingId } — join_url is what goes to both
 * people; start_url (host-only) is saved too in case the tutor wants it, but
 * the app itself only surfaces join_url today.
 */
async function createMeeting({ topic, day, startTime, endTime }) {
  const token = await getAccessToken()
  const startDate = nextOccurrence(day, startTime)
  const duration = Math.max(minutesBetween(startTime, endTime), 15)

  const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: topic.slice(0, 200),
      type: 2, // scheduled, fixed time
      start_time: startDate.toISOString(),
      duration,
      timezone: 'Asia/Singapore',
      settings: {
        join_before_host: true,
        waiting_room: false,
        mute_upon_entry: true,
        approval_type: 2, // no registration required
      },
    }),
  })
  if (!res.ok) throw new Error(`Zoom meeting creation failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { joinUrl: data.join_url, startUrl: data.start_url, meetingId: data.id }
}

module.exports = { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, createMeeting, nextOccurrence }
