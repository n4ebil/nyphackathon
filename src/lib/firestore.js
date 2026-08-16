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

// ---------------------------------------------------------------- match requests

/** matchId (from findMatches, `${requestId}--${tutorId}`) is used as the doc id so a match can only be requested once. */
export async function sendMatchRequest(matchRequest) {
  await setDoc(doc(db, 'matchRequests', matchRequest.matchId), matchRequest)
}

export async function listMatchRequests(userId) {
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
  await updateDoc(doc(db, 'matchRequests', matchId), { status })
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

// ---------------------------------------------------------------- extra classes
// A teacher opens a one-off extra class; anyone can register interest in
// attending. Separate from the 1:1 matched sessions above.

export async function createClassSession(classSession) {
  const ref = await addDoc(collection(db, 'classSessions'), classSession)
  return { classId: ref.id, ...classSession }
}

export async function listClassSessions() {
  const snap = await getDocs(collection(db, 'classSessions'))
  return snap.docs.map((d) => ({ classId: d.id, ...d.data() }))
}

export async function deleteClassSession(classId) {
  await deleteDoc(doc(db, 'classSessions', classId))
}

/** Doc id is `${classId}--${userId}` so registering twice just no-ops instead of duplicating. */
export async function registerInterest(classId, userId, userName) {
  await setDoc(doc(db, 'classInterests', `${classId}--${userId}`), {
    classId,
    userId,
    userName,
    createdAt: new Date().toISOString(),
  })
}

export async function unregisterInterest(classId, userId) {
  await deleteDoc(doc(db, 'classInterests', `${classId}--${userId}`))
}

export async function listAllClassInterests() {
  const snap = await getDocs(collection(db, 'classInterests'))
  return snap.docs.map((d) => d.data())
}
