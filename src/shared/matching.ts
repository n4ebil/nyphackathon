import { areRelatedModules } from './nyp.ts'
import type {
  AvailabilitySlot,
  LearningRequest,
  LearningFormat,
  Match,
  ScoreFactor,
  TeachingSubject,
  User,
} from './types.ts'

/**
 * Deterministic compatibility scoring.
 *
 * Weights come straight from the project plan and must add up to 100:
 *   module 40 · topics 25 · availability 20 · format 10 · experience 5
 *
 * Nothing here calls an AI model on purpose — the number a student sees has to
 * be reproducible and explainable line by line. Bedrock only phrases the
 * result afterwards (see `buildExplanation`).
 */
export const WEIGHTS = {
  module: 40,
  topics: 25,
  availability: 20,
  format: 10,
  experience: 5,
} as const

/** Shared free time above this (minutes/week) counts as full marks. */
const AVAILABILITY_TARGET_MINUTES = 120

export interface ScoreInput {
  request: LearningRequest
  student: User
  studentSlots: AvailabilitySlot[]
  tutor: User
  tutorSubject: TeachingSubject
  tutorSlots: AvailabilitySlot[]
}

export interface ScoreResult {
  score: number
  breakdown: ScoreFactor[]
  sharedSlots: AvailabilitySlot[]
  /** Requested topics this tutor actually lists — used to phrase the explanation. */
  coveredTopics: string[]
}

/** "14:30" -> 870 */
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

/** Slots the two students can both make, clipped to the overlapping window. */
export function overlappingSlots(
  a: AvailabilitySlot[],
  b: AvailabilitySlot[],
): AvailabilitySlot[] {
  const shared: AvailabilitySlot[] = []
  for (const slotA of a) {
    for (const slotB of b) {
      if (slotA.day !== slotB.day) continue
      const start = Math.max(toMinutes(slotA.startTime), toMinutes(slotB.startTime))
      const end = Math.min(toMinutes(slotA.endTime), toMinutes(slotB.endTime))
      if (end - start < 30) continue // too short to be a useful session
      shared.push({
        userId: 'shared',
        day: slotA.day,
        startTime: fromMinutes(start),
        endTime: fromMinutes(end),
      })
    }
  }
  return shared
}

function fromMinutes(total: number): string {
  const h = String(Math.floor(total / 60)).padStart(2, '0')
  const m = String(total % 60).padStart(2, '0')
  return `${h}:${m}`
}

function slotMinutes(slots: AvailabilitySlot[]): number {
  return slots.reduce((sum, s) => sum + (toMinutes(s.endTime) - toMinutes(s.startTime)), 0)
}

function scoreModule(request: LearningRequest, subject: TeachingSubject): ScoreFactor {
  if (subject.moduleId === request.moduleId) {
    return {
      label: 'Module compatibility',
      earned: WEIGHTS.module,
      max: WEIGHTS.module,
      detail: `Teaches ${subject.moduleName} — the exact competency you need`,
    }
  }
  // "Related" means a real diploma teaches both competencies, not a guess from
  // the name — see areRelatedModules in nyp.ts.
  if (areRelatedModules(subject.moduleId, request.moduleId)) {
    return {
      label: 'Module compatibility',
      earned: Math.round(WEIGHTS.module / 2),
      max: WEIGHTS.module,
      detail: `Teaches ${subject.moduleName}, a competency taught alongside ${request.moduleName} in some diplomas`,
    }
  }
  return {
    label: 'Module compatibility',
    earned: 0,
    max: WEIGHTS.module,
    detail: `Teaches ${subject.moduleName}, an unrelated competency`,
  }
}

function scoreTopics(
  request: LearningRequest,
  subject: TeachingSubject,
): { factor: ScoreFactor; covered: string[] } {
  const wanted = request.topics
  const covered = wanted.filter((topic) =>
    subject.topics.some((t) => t.toLowerCase() === topic.toLowerCase()),
  )
  if (!wanted.length) {
    return {
      covered,
      factor: {
        label: 'Topic compatibility',
        earned: 0,
        max: WEIGHTS.topics,
        detail: 'No specific topics requested',
      },
    }
  }
  // Confidence nudges the score but never dominates it: 1/5 -> x0.84, 5/5 -> x1.
  const confidenceFactor = 0.8 + 0.2 * (subject.confidence / 5)
  const earned = Math.round(WEIGHTS.topics * (covered.length / wanted.length) * confidenceFactor)
  return {
    covered,
    factor: {
      label: 'Topic compatibility',
      earned,
      max: WEIGHTS.topics,
      detail: covered.length
        ? `Covers ${covered.length}/${wanted.length} of your topics (${covered.join(', ')}) · confidence ${subject.confidence}/5`
        : `Does not list any of your topics`,
    },
  }
}

function scoreAvailability(shared: AvailabilitySlot[]): ScoreFactor {
  const minutes = slotMinutes(shared)
  const earned = Math.round(
    WEIGHTS.availability * Math.min(minutes / AVAILABILITY_TARGET_MINUTES, 1),
  )
  return {
    label: 'Availability overlap',
    earned,
    max: WEIGHTS.availability,
    detail: minutes
      ? `${formatDuration(minutes)} of shared free time (${shared
          .slice(0, 2)
          .map((s) => `${s.day} ${s.startTime}–${s.endTime}`)
          .join(', ')}${shared.length > 2 ? ', …' : ''})`
      : 'No overlapping free time this week',
  }
}

function scoreFormat(want: LearningFormat, tutor: LearningFormat): ScoreFactor {
  const label = 'Learning format'
  if (want === tutor) {
    return {
      label,
      earned: WEIGHTS.format,
      max: WEIGHTS.format,
      detail: `You both prefer ${want} sessions`,
    }
  }
  if (want === 'either' || tutor === 'either') {
    return {
      label,
      earned: 7,
      max: WEIGHTS.format,
      detail: `Flexible — ${tutor === 'either' ? 'they are' : 'you are'} happy either way`,
    }
  }
  return {
    label,
    earned: 0,
    max: WEIGHTS.format,
    detail: `You want ${want}, they prefer ${tutor}`,
  }
}

function scoreExperience(subject: TeachingSubject): ScoreFactor {
  const earned = Math.round(WEIGHTS.experience * Math.min(subject.experience / 5, 1))
  return {
    label: 'Tutor experience',
    earned,
    max: WEIGHTS.experience,
    detail: subject.experience
      ? `Has tutored this module ${subject.experience} time${subject.experience === 1 ? '' : 's'}`
      : 'New to tutoring this module',
  }
}

export function scoreMatch(input: ScoreInput): ScoreResult {
  const shared = overlappingSlots(input.studentSlots, input.tutorSlots)
  const topics = scoreTopics(input.request, input.tutorSubject)
  const breakdown = [
    scoreModule(input.request, input.tutorSubject),
    topics.factor,
    scoreAvailability(shared),
    scoreFormat(input.request.preferredFormat, input.tutor.preferredFormat),
    scoreExperience(input.tutorSubject),
  ]
  return {
    score: breakdown.reduce((sum, f) => sum + f.earned, 0),
    breakdown,
    sharedSlots: shared,
    coveredTopics: topics.covered,
  }
}

export type ScoreLabel = 'Excellent Match' | 'Good Match' | 'Possible Match' | 'Not recommended'

export function scoreLabel(score: number): ScoreLabel {
  if (score >= 80) return 'Excellent Match'
  if (score >= 60) return 'Good Match'
  if (score >= 40) return 'Possible Match'
  return 'Not recommended'
}

/** Matches below this are hidden and the no-match recovery screen takes over. */
export const MIN_RECOMMENDED_SCORE = 40

export interface MatchInput {
  student: User
  request: LearningRequest
  studentSlots: AvailabilitySlot[]
  candidates: User[]
  teachingSubjects: TeachingSubject[]
  availability: AvailabilitySlot[]
  /** What the student themselves can teach — powers reciprocal detection. */
  studentTeaches: TeachingSubject[]
  /** Open requests from everyone, used to spot a mutual learning opportunity. */
  openRequests: LearningRequest[]
}

/**
 * Rank every candidate tutor for one learning request.
 * Returns matches sorted high to low, including ones below the recommend
 * threshold so the caller can decide whether to show alternatives.
 */
export function findMatches(input: MatchInput): Match[] {
  const matches: Match[] = []

  for (const tutor of input.candidates) {
    if (tutor.userId === input.student.userId) continue

    const subjects = input.teachingSubjects.filter((s) => s.userId === tutor.userId)
    if (!subjects.length) continue

    // A tutor may teach several relevant modules — keep only their best fit.
    const tutorSlots = input.availability.filter((a) => a.userId === tutor.userId)
    let best: (ScoreResult & { subject: TeachingSubject }) | null = null
    for (const subject of subjects) {
      const result = scoreMatch({
        request: input.request,
        student: input.student,
        studentSlots: input.studentSlots,
        tutor,
        tutorSubject: subject,
        tutorSlots,
      })
      if (!best || result.score > best.score) best = { ...result, subject }
    }
    if (!best) continue

    matches.push({
      matchId: `${input.request.requestId}--${tutor.userId}`,
      studentId: input.student.userId,
      tutorId: tutor.userId,
      tutor,
      moduleId: best.subject.moduleId,
      moduleName: best.subject.moduleName,
      score: best.score,
      breakdown: best.breakdown,
      coveredTopics: best.coveredTopics,
      sharedSlots: best.sharedSlots,
      reciprocal: findReciprocal(tutor, input),
      status: 'suggested',
      explanation: undefined,
    })
  }

  return matches.sort((a, b) => b.score - a.score)
}

/** True when the student can teach something this tutor is asking for help with. */
function findReciprocal(tutor: User, input: MatchInput): { moduleName: string } | undefined {
  const tutorNeeds = input.openRequests.filter((r) => r.userId === tutor.userId)
  for (const need of tutorNeeds) {
    const canTeach = input.studentTeaches.find((s) => s.moduleId === need.moduleId)
    if (canTeach) return { moduleName: canTeach.moduleName }
  }
  return undefined
}

/**
 * Local stand-in for the Bedrock explanation (phase 6).
 * Keeps the UI honest before the model is wired up: same shape, same slot.
 */
export function buildExplanation(match: Match, request: LearningRequest): string {
  const ratio = (label: string) => {
    const factor = match.breakdown.find((f) => f.label === label)
    return factor ? factor.earned / factor.max : 0
  }

  const name = match.tutor.name
  const label = scoreLabel(match.score).toLowerCase()
  const article = /^[aeiou]/.test(label) ? 'an' : 'a'
  // "is a not recommended for X" does not parse — that band needs its own wording.
  const opener =
    match.score >= MIN_RECOMMENDED_SCORE
      ? `${name} is ${article} ${label} for ${request.moduleName}.`
      : `${name} is not a strong match for ${request.moduleName}.`

  const strengths: string[] = []
  if (ratio('Module compatibility') === 1) strengths.push(`teach ${request.moduleName} directly`)
  else if (ratio('Module compatibility') > 0) strengths.push('teach a closely related module')

  // Topics are listed parenthetically rather than with "and", so the clause can
  // itself be joined with "and" without stacking two of them side by side.
  const topics = match.coveredTopics
  if (topics.length === request.topics.length && topics.length)
    strengths.push(`cover every topic you asked about (${topics.join(', ')})`)
  else if (topics.length)
    strengths.push(
      `cover ${topics.length} of your ${request.topics.length} topics (${topics.join(', ')})`,
    )

  if (ratio('Availability overlap') === 1) strengths.push('have plenty of free time in common with you')
  else if (ratio('Availability overlap') > 0) strengths.push('share some free time with you')

  if (ratio('Learning format') === 1) strengths.push('prefer the same session format as you')

  // Only one caveat — the weakest factor that actually costs meaningful points.
  const caveats: string[] = []
  if (ratio('Availability overlap') === 0) caveats.push('you have no overlapping free time yet')
  else if (ratio('Learning format') === 0)
    caveats.push(`they prefer ${match.tutor.preferredFormat} sessions rather than ${request.preferredFormat}`)
  else if (ratio('Tutor experience') < 0.5)
    caveats.push('they are relatively new to tutoring this module')

  const sentences = [opener]
  if (strengths.length) sentences.push(`They ${joinList(strengths.slice(0, 3))}.`)
  if (caveats.length) sentences.push(`Worth knowing: ${caveats[0]}.`)
  if (match.reciprocal)
    sentences.push(
      `You could also help them with ${match.reciprocal.moduleName}, so this works both ways.`,
    )
  return sentences.join(' ')
}

/** "a", "a and b", "a, b and c" */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
