import type { Achievement, Feedback, MatchRequest, Session, TeachingSubject } from './types.ts'

/**
 * Badges, computed fresh from real data every time — never stored, never
 * awarded manually. Same reasoning as computeTutorStats in reliability.ts:
 * anything that looks like a status should be reproducible from the actual
 * session/feedback history, not a flag someone could get out of sync.
 *
 * Returns every defined badge, earned or not, with progress on the
 * not-yet-earned count-based ones — a locked badge with "3/5" underneath is
 * what makes a badge case feel like a system worth coming back to, instead
 * of just a handful of icons that showed up once.
 */
export interface AchievementsInput {
  userId: string
  sessions: Session[]
  matchRequests: MatchRequest[]
  feedback: Feedback[]
  teachingSubjects: TeachingSubject[]
}

/** Coarse but stable week bucket — doesn't need to be exact ISO-8601 week numbering, just consistent for spotting consecutive weeks. */
function weekIndex(iso: string): number {
  const d = new Date(iso)
  const firstJan = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d.getTime() - firstJan.getTime()) / 86_400_000)
  const week = Math.floor((days + firstJan.getDay()) / 7)
  return d.getFullYear() * 53 + week
}

function longestConsecutiveWeeks(isoDates: string[]): number {
  const weeks = [...new Set(isoDates.map(weekIndex))].sort((a, b) => a - b)
  if (!weeks.length) return 0
  let longest = 1
  let current = 1
  for (let i = 1; i < weeks.length; i++) {
    current = weeks[i] === weeks[i - 1] + 1 ? current + 1 : 1
    longest = Math.max(longest, current)
  }
  return longest
}

function milestone(id: string, icon: string, title: string, description: string, current: number, target: number): Achievement {
  return {
    id,
    icon,
    title,
    description,
    earned: current >= target,
    progress: current >= target ? undefined : { current: Math.min(current, target), target },
  }
}

export function computeAchievements(input: AchievementsInput): Achievement[] {
  const { userId, sessions, matchRequests, feedback, teachingSubjects } = input

  const tutorMatchIds = new Set(matchRequests.filter((r) => r.tutorId === userId).map((r) => r.matchId))
  const studentMatchIds = new Set(matchRequests.filter((r) => r.studentId === userId).map((r) => r.matchId))

  const completedAsTutor = sessions.filter((s) => s.status === 'completed' && tutorMatchIds.has(s.matchId))
  const completedAsStudent = sessions.filter((s) => s.status === 'completed' && studentMatchIds.has(s.matchId))

  const ratingsReceived = feedback.filter((f) => f.toUser === userId)
  const avgRating = ratingsReceived.length
    ? ratingsReceived.reduce((sum, f) => sum + f.rating, 0) / ratingsReceived.length
    : null

  const feedbackGiven = feedback.filter((f) => f.fromUser === userId).length
  const anyAccepted = matchRequests.some((r) => (r.tutorId === userId || r.studentId === userId) && r.status === 'accepted')
  const modulesTaught = new Set(teachingSubjects.filter((s) => s.userId === userId).map((s) => s.moduleId)).size

  const teachingStreak = longestConsecutiveWeeks(completedAsTutor.map((s) => s.completedAt).filter((v): v is string => Boolean(v)))

  return [
    // Tutoring
    milestone('first-session-taught', '🎓', 'First Session Taught', 'Complete your first session as a tutor.', completedAsTutor.length, 1),
    milestone('regular-tutor', '📚', 'Regular Tutor', 'Complete 5 sessions as a tutor.', completedAsTutor.length, 5),
    milestone('veteran-tutor', '🏆', 'Veteran Tutor', 'Complete 25 sessions as a tutor.', completedAsTutor.length, 25),
    {
      id: 'highly-rated',
      icon: '⭐',
      title: 'Highly Rated',
      description: 'Average 4.5+ stars across at least 3 reviews.',
      earned: avgRating != null && avgRating >= 4.5 && ratingsReceived.length >= 3,
    },
    {
      id: 'top-rated',
      icon: '🌟',
      title: 'Top Rated',
      description: 'Average 4.8+ stars across at least 10 reviews.',
      earned: avgRating != null && avgRating >= 4.8 && ratingsReceived.length >= 10,
    },
    {
      id: 'on-a-roll',
      icon: '🔥',
      title: 'On a Roll',
      description: 'Complete a tutoring session in 3 consecutive weeks.',
      earned: teachingStreak >= 3,
    },
    milestone('multi-subject', '🌐', 'Multi-Subject Tutor', 'List 3 or more competencies you teach.', modulesTaught, 3),

    // Learning
    milestone('getting-started', '🚀', 'Getting Started', 'Complete your first session as a student.', completedAsStudent.length, 1),
    milestone('dedicated-learner', '📖', 'Dedicated Learner', 'Complete 5 sessions as a student.', completedAsStudent.length, 5),
    milestone('super-learner', '🧠', 'Super Learner', 'Complete 25 sessions as a student.', completedAsStudent.length, 25),

    // General
    {
      id: 'first-match',
      icon: '🤝',
      title: 'First Match',
      description: 'Get your first tutoring request accepted.',
      earned: anyAccepted,
    },
    milestone('good-feedback-giver', '💬', 'Good Feedback Giver', 'Leave feedback on 5 sessions.', feedbackGiven, 5),
  ]
}
