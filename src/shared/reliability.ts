import type { Feedback, MatchRequest, Session, TeachingSubject, TutorStats } from './types.ts'

/**
 * Tutor reliability, computed fresh from real Firestore data every time —
 * never stored or faked. A tutor with no history yet is "new", not "bad":
 * scoring and UI both need to treat that as neutral, not a penalty for
 * simply not having a track record.
 */
export interface ReliabilityInput {
  tutorId: string
  feedback: Feedback[]
  sessions: Session[]
  /** All match requests the tutor has *received* (as tutor), to compute how often they respond at all. */
  matchRequests: MatchRequest[]
  teachingSubjects: TeachingSubject[]
}

export function computeTutorStats(input: ReliabilityInput): TutorStats {
  const { tutorId, feedback, sessions, matchRequests, teachingSubjects } = input

  const received = matchRequests.filter((r) => r.tutorId === tutorId)
  const completedMatchIds = new Set(
    sessions.filter((s) => s.status === 'completed').map((s) => s.matchId),
  )
  const completedForTutor = received.filter((r) => completedMatchIds.has(r.matchId))

  const ratings = feedback.filter((f) => f.toUser === tutorId)
  const avgRating = ratings.length
    ? Math.round((ratings.reduce((sum, f) => sum + f.rating, 0) / ratings.length) * 10) / 10
    : null

  const withHelpful = ratings.filter((f) => typeof f.helpful === 'boolean')
  const helpfulRate = withHelpful.length
    ? Math.round((withHelpful.filter((f) => f.helpful).length / withHelpful.length) * 100)
    : null

  const responded = received.filter((r) => r.status !== 'pending')
  const responseRate = received.length ? Math.round((responded.length / received.length) * 100) : null

  const studentsHelped = new Set(completedForTutor.map((r) => r.studentId)).size
  const topicsTaught = teachingSubjects.filter((s) => s.userId === tutorId).length

  return {
    sessionsCompleted: completedForTutor.length,
    studentsHelped,
    avgRating,
    ratingCount: ratings.length,
    helpfulRate,
    responseRate,
    topicsTaught,
    isNew: completedForTutor.length === 0 && ratings.length === 0,
  }
}
