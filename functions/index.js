const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { setGlobalOptions } = require('firebase-functions/v2')
const logger = require('firebase-functions/logger')

const email = require('./email')
const { createMeeting, ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, nextOccurrence } = require('./zoom')

initializeApp()
const db = getFirestore()

// Singapore region — this is an NYP app, no reason to run it in us-central1.
setGlobalOptions({ region: 'asia-southeast1' })

const EMAIL_SECRETS = [email.GMAIL_USER, email.GMAIL_APP_PASSWORD]
const ALL_SECRETS = [...EMAIL_SECRETS, ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET]

async function getUser(uid) {
  const snap = await db.doc(`users/${uid}`).get()
  return snap.exists ? snap.data() : null
}

// ---------------------------------------------------------------- 1. request sent

exports.onMatchRequestCreated = onDocumentCreated({ document: 'matchRequests/{matchId}', secrets: EMAIL_SECRETS }, async (event) => {
  const r = event.data.data()
  const [tutor, student] = await Promise.all([getUser(r.tutorId), getUser(r.studentId)])
  if (!tutor || !student) return

  await Promise.all([
    email.sendRequestReceived({
      tutorEmail: tutor.email,
      tutorName: tutor.name,
      studentName: student.name || student.email,
      moduleName: r.moduleName,
      message: r.message,
    }),
    email.sendRequestSentConfirmation({
      studentEmail: student.email,
      studentName: student.name,
      tutorName: tutor.name || tutor.email,
      moduleName: r.moduleName,
    }),
  ])
})

// ---------------------------------------------------------------- 2. session confirmed (+ Zoom)

exports.onSessionCreated = onDocumentCreated({ document: 'sessions/{matchId}', secrets: ALL_SECRETS }, async (event) => {
  const matchId = event.params.matchId
  const session = event.data.data()

  const matchSnap = await db.doc(`matchRequests/${matchId}`).get()
  if (!matchSnap.exists) return
  const match = matchSnap.data()
  const [tutor, student] = await Promise.all([getUser(match.tutorId), getUser(match.studentId)])
  if (!tutor || !student) return

  let zoomLink = null
  if (session.format === 'online') {
    try {
      const meeting = await createMeeting({
        topic: `${match.moduleName} — ${tutor.name} & ${student.name}`,
        day: session.day,
        startTime: session.startTime,
        endTime: session.endTime,
      })
      zoomLink = meeting.joinUrl
      await event.data.ref.set({ zoomLink: meeting.joinUrl, zoomStartUrl: meeting.startUrl, zoomMeetingId: meeting.meetingId }, { merge: true })
    } catch (err) {
      // A real Zoom account/app must exist for this to succeed — if it's not configured yet,
      // don't block the session or the email over it; the tutor can still add a link manually.
      logger.error('Zoom meeting creation failed, continuing without it', err)
    }
  }

  const location = zoomLink || session.location
  const when = email.formatWeekday(session.day, session.startTime, session.endTime)

  await Promise.all([
    email.sendSessionConfirmed({
      toEmail: tutor.email, toName: tutor.name, otherName: student.name || student.email,
      moduleName: match.moduleName, when, format: session.format, location, zoomLink,
    }),
    email.sendSessionConfirmed({
      toEmail: student.email, toName: student.name, otherName: tutor.name || tutor.email,
      moduleName: match.moduleName, when, format: session.format, location, zoomLink,
    }),
  ])
})

// ---------------------------------------------------------------- 3. group class confirmed (Schedule page)

exports.onClassRequestUpdated = onDocumentUpdated({ document: 'classRequests/{requestId}', secrets: EMAIL_SECRETS }, async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  if (before.status === 'scheduled' || after.status !== 'scheduled') return // only fire on the transition into 'scheduled'

  const requestId = event.params.requestId
  const interests = await db.collection('classInterests').where('requestId', '==', requestId).get()
  const recipientIds = new Set(interests.docs.map((d) => d.data().userId))
  recipientIds.add(after.studentId)

  const users = await Promise.all([...recipientIds].map(getUser))
  await Promise.all(
    users.filter(Boolean).map((u) =>
      email.sendClassConfirmed({
        toEmail: u.email, toName: u.name, moduleName: after.moduleName, teacherName: after.teacherName,
        date: after.date, startTime: after.startTime, endTime: after.endTime, location: after.location,
      }),
    ),
  )
})

// ---------------------------------------------------------------- 4. reminders (scheduled)

const REMINDER_WINDOW_HOURS = 24

exports.sendClassReminders = onSchedule({ schedule: 'every 30 minutes', secrets: EMAIL_SECRETS }, async () => {
  const now = new Date()

  // 1:1 sessions.
  const sessionsSnap = await db.collection('sessions').where('status', '==', 'arranged').get()
  for (const doc of sessionsSnap.docs) {
    const session = doc.data()
    if (session.reminderSentAt) continue
    const startAt = nextOccurrence(session.day, session.startTime)
    const hoursAway = (startAt.getTime() - now.getTime()) / 3_600_000
    if (hoursAway <= 0 || hoursAway > REMINDER_WINDOW_HOURS) continue

    const matchSnap = await db.doc(`matchRequests/${doc.id}`).get()
    if (!matchSnap.exists) continue
    const match = matchSnap.data()
    const [tutor, student] = await Promise.all([getUser(match.tutorId), getUser(match.studentId)])
    if (!tutor || !student) continue

    const location = session.zoomLink || session.location
    const when = email.formatWeekday(session.day, session.startTime, session.endTime)
    await Promise.all([
      email.sendSessionReminder({
        toEmail: tutor.email, toName: tutor.name, otherName: student.name || student.email, moduleName: match.moduleName,
        when, format: session.format, location, zoomLink: session.zoomLink, hoursAway: Math.round(hoursAway),
      }),
      email.sendSessionReminder({
        toEmail: student.email, toName: student.name, otherName: tutor.name || tutor.email, moduleName: match.moduleName,
        when, format: session.format, location, zoomLink: session.zoomLink, hoursAway: Math.round(hoursAway),
      }),
    ])
    await doc.ref.set({ reminderSentAt: now.toISOString() }, { merge: true })
  }

  // Scheduled group classes.
  const classesSnap = await db.collection('classRequests').where('status', '==', 'scheduled').get()
  for (const doc of classesSnap.docs) {
    const req = doc.data()
    if (req.reminderSentAt || !req.date) continue
    const startAt = new Date(`${req.date}T${req.startTime || '00:00'}:00+08:00`)
    const hoursAway = (startAt.getTime() - now.getTime()) / 3_600_000
    if (hoursAway <= 0 || hoursAway > REMINDER_WINDOW_HOURS) continue

    const interests = await db.collection('classInterests').where('requestId', '==', doc.id).get()
    const recipientIds = new Set(interests.docs.map((d) => d.data().userId))
    recipientIds.add(req.studentId)
    const users = await Promise.all([...recipientIds].map(getUser))
    const when = email.formatDate(req.date, req.startTime, req.endTime)
    await Promise.all(
      users.filter(Boolean).map((u) =>
        email.sendSessionReminder({
          toEmail: u.email, toName: u.name, otherName: req.teacherName, moduleName: req.moduleName,
          when, format: 'in-person', location: req.location, zoomLink: null, hoursAway: Math.round(hoursAway),
        }),
      ),
    )
    await doc.ref.set({ reminderSentAt: now.toISOString() }, { merge: true })
  }
})
