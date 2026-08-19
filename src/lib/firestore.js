import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { isAdminEmail } from './admin.js'

// ---------------------------------------------------------------- student directory
// Pre-imported roster (name + course by admin number) so registration can
// auto-fill those fields. Doc id is the admin number, uppercased. Readable
// without signing in — registration happens before an account exists — so
// keep this to non-sensitive fields only (no email/contact info).

export async function lookupStudent(adminNo) {
  if (!adminNo) return null
  const snap = await getDoc(doc(db, 'studentDirectory', adminNo.trim().toUpperCase()))
  return snap.exists() ? snap.data() : null
}

export async function listDirectory() {
  const snap = await getDocs(collection(db, 'studentDirectory'))
  return snap.docs.map((d) => d.data())
}

/** Firestore batches cap at 500 writes, so chunk large imports. */
export async function importDirectoryRows(rows) {
  const chunks = []
  for (let i = 0; i < rows.length; i += 450) chunks.push(rows.slice(i, i + 450))
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    for (const row of chunk) {
      batch.set(doc(db, 'studentDirectory', row.adminNo), row)
    }
    await batch.commit()
  }
}

// ---------------------------------------------------------------- users

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? { userId: uid, ...snap.data() } : null
}

export async function upsertUserProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), data, { merge: true })
}

export async function listUsers() {
  const snap = await getDocs(collection(db, 'users'))
  return snap.docs.map((d) => ({ userId: d.id, ...d.data() }))
}

/**
 * Deletes the Firestore profile only — there's no Admin SDK/backend here, so
 * the Firebase Auth account itself can't be deleted or disabled client-side.
 * Combined with the `locked` flag (enforced in AuthContext), this is the
 * practical equivalent: a deleted/locked user can still authenticate but the
 * app treats them as having no usable profile and signs them straight out.
 */
export async function deleteUserProfile(userId) {
  await deleteDoc(doc(db, 'users', userId))
}

// ---------------------------------------------------------------- teaching subjects

export async function getTeachingSubjects(userId) {
  const snap = await getDocs(query(collection(db, 'teachingSubjects'), where('userId', '==', userId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function listAllTeachingSubjects() {
  const snap = await getDocs(collection(db, 'teachingSubjects'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Admin moderation — removes a single listing (e.g. bad/duplicate entry) without touching the tutor's account. */
export async function deleteTeachingSubject(docId) {
  await deleteDoc(doc(db, 'teachingSubjects', docId))
}

/** Swaps a user's whole teaching list in one go — simplest correct model for a small self-reported list. */
export async function replaceTeachingSubjects(userId, subjects) {
  const existing = await getTeachingSubjects(userId)
  await Promise.all(existing.map((s) => deleteDoc(doc(db, 'teachingSubjects', s.id))))
  await Promise.all(subjects.map((s) => addDoc(collection(db, 'teachingSubjects'), { ...s, userId })))
}

// ---------------------------------------------------------------- availability

export async function getAvailability(userId) {
  const snap = await getDocs(query(collection(db, 'availability'), where('userId', '==', userId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function listAllAvailability() {
  const snap = await getDocs(collection(db, 'availability'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function replaceAvailability(userId, slots) {
  const existing = await getAvailability(userId)
  await Promise.all(existing.map((s) => deleteDoc(doc(db, 'availability', s.id))))
  await Promise.all(slots.map((s) => addDoc(collection(db, 'availability'), { ...s, userId })))
}

// ---------------------------------------------------------------- learning requests

export async function createLearningRequest(request) {
  const ref = await addDoc(collection(db, 'learningRequests'), request)
  return { requestId: ref.id, ...request }
}

export async function listAllLearningRequests() {
  const snap = await getDocs(collection(db, 'learningRequests'))
  return snap.docs.map((d) => ({ requestId: d.id, ...d.data() }))
}

export async function getLearningRequest(requestId) {
  const snap = await getDoc(doc(db, 'learningRequests', requestId))
  return snap.exists() ? { requestId: snap.id, ...snap.data() } : null
}

// ---------------------------------------------------------------- match requests
// Backed by AWS (API Gateway -> Lambda -> DynamoDB) when VITE_API_BASE_URL is
// set; falls back to Firestore otherwise so local dev / a not-yet-deployed
// Lambda never breaks the app. See src/lib/awsApi.js.

import {
isAwsConfigured,
sendMatchRequestRemote,
listMatchRequestsRemote,
listAllMatchRequestsRemote,
respondToMatchRequestRemote,
} from './awsApi.js'

/** matchId (from findMatches, `${requestId}--${tutorId}`) is used as the doc id / partition key so a match can only be requested once. */
export async function sendMatchRequest(matchRequest) {
if (isAwsConfigured) return sendMatchRequestRemote(matchRequest)
await setDoc(doc(db, 'matchRequests', matchRequest.matchId), matchRequest)
}

export async function listMatchRequests(userId) {
if (isAwsConfigured) return listMatchRequestsRemote(userId)
const [incoming, outgoing] = await Promise.all([
getDocs(query(collection(db, 'matchRequests'), where('tutorId', '==', userId))),
getDocs(query(collection(db, 'matchRequests'), where('studentId', '==', userId))),
])
return {
incoming: incoming.docs.map((d) => d.data()),
outgoing: outgoing.docs.map((d) => d.data()),
}
}

export async function respondToMatchRequest(matchId, status) {
if (isAwsConfigured) return respondToMatchRequestRemote(matchId, status)
await updateDoc(doc(db, 'matchRequests', matchId), { status })
}

export async function listAllMatchRequests() {
if (isAwsConfigured) return listAllMatchRequestsRemote()
const snap = await getDocs(collection(db, 'matchRequests'))
return snap.docs.map((d) => d.data())
}

/** Admin moderation — there's no delete endpoint (AWS-backed or Firestore), so cancelling means rejecting like a tutor would. */
export async function cancelMatchRequest(matchId) {
  return respondToMatchRequest(matchId, 'rejected')
}

// ---------------------------------------------------------------- sessions

export async function getSessionsByMatchIds(matchIds) {
  const snaps = await Promise.all(matchIds.map((id) => getDoc(doc(db, 'sessions', id))))
  return snaps.filter((s) => s.exists()).map((s) => s.data())
}

export async function arrangeSession(matchId, details = {}) {
  const session = {
    matchId,
    day: details.day || 'Sat',
    startTime: details.startTime || '14:00',
    endTime: details.endTime || '15:00',
    format: details.format || 'in-person',
    location: details.location || 'Campus library',
    status: 'arranged',
  }
  await setDoc(doc(db, 'sessions', matchId), session)
  await respondToMatchRequest(matchId, 'accepted')
  return session
}

export async function listAllSessions() {
  const snap = await getDocs(collection(db, 'sessions'))
  return snap.docs.map((d) => d.data())
}

export async function completeSession(matchId) {
  await updateDoc(doc(db, 'sessions', matchId), { status: 'completed' })
}

export async function cancelSession(matchId) {
  await updateDoc(doc(db, 'sessions', matchId), { status: 'cancelled' })
}

/** Reschedules an already-arranged session — day/time/format/location, no status change. */
export async function editSession(matchId, details) {
  await updateDoc(doc(db, 'sessions', matchId), {
    day: details.day,
    startTime: details.startTime,
    endTime: details.endTime,
    format: details.format,
    location: details.location,
  })
}

export async function saveSessionPlan(matchId, plan) {
  await updateDoc(doc(db, 'sessions', matchId), { plan })
}

// ---------------------------------------------------------------- feedback

export async function listAllFeedback() {
  const snap = await getDocs(collection(db, 'feedback'))
  return snap.docs.map((d) => d.data())
}

/** Doc id is `${sessionId}--${fromUser}` so a student can only rate a given session once. */
export async function submitFeedback(feedback) {
  await setDoc(doc(db, 'feedback', `${feedback.sessionId}--${feedback.fromUser}`), feedback)
}

// ---------------------------------------------------------------- class requests
// A student requests help with a module; others pile on interest. Once
// enough interest builds up, it's surfaced to tutors who teach that module —
// one of them can claim it, which schedules the actual class.

export async function createClassRequest(request) {
  const ref = await addDoc(collection(db, 'classRequests'), request)
  return { requestId: ref.id, ...request }
}

export async function listClassRequests() {
  const snap = await getDocs(collection(db, 'classRequests'))
  return snap.docs.map((d) => ({ requestId: d.id, ...d.data() }))
}

/** A qualified tutor claims the request, locking in when/where it happens. */
export async function scheduleClassRequest(requestId, details) {
  await updateDoc(doc(db, 'classRequests', requestId), {
    status: 'scheduled',
    teacherId: details.teacherId,
    teacherName: details.teacherName,
    date: details.date,
    startTime: details.startTime,
    endTime: details.endTime,
    location: details.location,
  })
}

export async function deleteClassRequest(requestId) {
  await deleteDoc(doc(db, 'classRequests', requestId))
}

/** Doc id is `${requestId}--${userId}` so registering twice just no-ops. */
export async function registerInterest(requestId, userId, userName) {
  await setDoc(doc(db, 'classInterests', `${requestId}--${userId}`), {
    requestId,
    userId,
    userName,
    createdAt: new Date().toISOString(),
  })
}

export async function unregisterInterest(requestId, userId) {
  await deleteDoc(doc(db, 'classInterests', `${requestId}--${userId}`))
}

export async function listAllClassInterests() {
  const snap = await getDocs(collection(db, 'classInterests'))
  return snap.docs.map((d) => d.data())
}

// ---------------------------------------------------------------- admin emails
// Grants admin on top of the hardcoded bootstrap list in src/lib/admin.js (see
// isAdmin() in firestore.rules) — lets admins add/remove other admins from the
// UI without a code deploy, while the bootstrap list guarantees at least one
// account can always get back in.

export async function listAdminEmails() {
  const snap = await getDocs(collection(db, 'adminEmails'))
  return snap.docs.map((d) => d.id)
}

export async function addAdminEmail(email) {
  await setDoc(doc(db, 'adminEmails', email.trim().toLowerCase()), { addedAt: new Date().toISOString() })
}

export async function removeAdminEmail(email) {
  await deleteDoc(doc(db, 'adminEmails', email.trim().toLowerCase()))
}

/** Mirrors firestore.rules' isAdmin(): the hardcoded bootstrap list, or a doc in adminEmails. */
export async function checkIsAdmin(email) {
  if (!email) return false
  if (isAdminEmail(email)) return true
  const snap = await getDoc(doc(db, 'adminEmails', email.toLowerCase()))
  return snap.exists()
}

// ---------------------------------------------------------------- messages
// One conversation per *person*, not per matchId — the same two people can have
// several matches over time (different modules, or tutor in one / student in
// another), and splitting those into separate threads just fragments one
// ongoing conversation. Each message still carries the matchId it was sent
// under, so the thread can show which session it belongs to.

// Fetched by single-field equality + filtered/sorted client-side (not a compound
// where+orderBy query) so this doesn't need a composite Firestore index — consistent
// with how sorting is already handled elsewhere in this file.
export async function listMessagesBetween(userIdA, userIdB) {
  const [fromA, fromB] = await Promise.all([
    getDocs(query(collection(db, 'messages'), where('fromUserId', '==', userIdA))),
    getDocs(query(collection(db, 'messages'), where('fromUserId', '==', userIdB))),
  ])
  return [...fromA.docs, ...fromB.docs]
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => (m.fromUserId === userIdA && m.toUserId === userIdB) || (m.fromUserId === userIdB && m.toUserId === userIdA))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** `type`/`proposal` are set for a reschedule proposal; plain messages omit them. */
export async function sendMessage({ matchId, fromUserId, toUserId, text, type, proposal }) {
  const payload = { matchId, fromUserId, toUserId, text, createdAt: new Date().toISOString() }
  if (type) payload.type = type
  if (proposal) payload.proposal = proposal
  if (type === 'proposal') payload.status = 'pending'
  await addDoc(collection(db, 'messages'), payload)
}

/** Accept/decline a reschedule proposal — only the recipient can call this (enforced in rules). */
export async function respondToProposal(messageId, status) {
  await updateDoc(doc(db, 'messages', messageId), { status })
}

/** Every message across all of the user's matches, for building a conversation list without one query per thread. */
export async function listAllMessagesFor(userId) {
  const [sent, received] = await Promise.all([
    getDocs(query(collection(db, 'messages'), where('fromUserId', '==', userId))),
    getDocs(query(collection(db, 'messages'), where('toUserId', '==', userId))),
  ])
  return [...sent.docs, ...received.docs].map((d) => ({ id: d.id, ...d.data() }))
}
