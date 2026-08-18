import { MODULES, modulesForCourse } from './nyp.ts'
import type { LearningFormat, Urgency, Weekday } from './types.ts'

/**
 * Local heuristic parser — the offline fallback for natural-language request
 * parsing. It reads a sentence like "I have a databases test next Monday and
 * I'm struggling with SQL joins" and pulls out module, topics, urgency and
 * deadline by keyword matching.
 *
 * The real path is Claude, in backend/src/ai.ts (`parseWithAI`), used
 * whenever the backend has `ANTHROPIC_API_KEY` set — see backend/.env.example.
 * `api.parseRequest` on the frontend never knows which one ran: both return
 * this same `ParsedRequest` shape, and the backend's `/ai/parse` route falls
 * back to this file whenever no key is configured or the call fails.
 */

export interface ParsedRequest {
  moduleId?: string
  moduleName?: string
  topics: string[]
  urgency: Urgency
  deadline?: string
  preferredFormat?: LearningFormat
  /** Preferred session length in minutes, when the text mentions one (e.g. "30 min", "an hour"). */
  duration?: number
  /** Which parts the parser is unsure about, surfaced in the UI for confirmation. */
  uncertain: string[]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAY_ABBR: Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const URGENT_WORDS = ['test', 'exam', 'tomorrow', 'urgent', 'deadline', 'assessment', 'due']

/**
 * `course` restricts auto-matching to that course's own competencies — a
 * student's request should never silently auto-select a competency from a
 * different diploma. When nothing in the course fits, `moduleId` comes back
 * undefined rather than reaching into the wider catalog; picking a
 * competency from another course is then a deliberate, manual choice in the
 * UI, not something the parser did for them. Pass no course (or a course
 * with no listed competencies) to search the full catalog.
 */
export function parseHelpRequest(text: string, course?: string, today = new Date()): ParsedRequest {
  const lower = text.toLowerCase()
  const uncertain: string[] = []
  const candidates = course && modulesForCourse(course).length ? modulesForCourse(course) : MODULES

  // Module: match on name or id, then fall back to the module whose topics are mentioned.
  let module = candidates.find(
    (m) => lower.includes(m.moduleName.toLowerCase()) || lower.includes(m.moduleId.toLowerCase()),
  )
  if (!module) {
    module = candidates.find((m) => m.topics.some((t) => lower.includes(t.toLowerCase())))
    if (module) uncertain.push('module')
  }

  // Topics: from the matched module's catalog, plus any catalog topic mentioned.
  const pool = module ? module.topics : candidates.flatMap((m) => m.topics)
  const topics = pool.filter((t) => lower.includes(t.toLowerCase()))

  const urgency: Urgency = URGENT_WORDS.some((w) => lower.includes(w))
    ? 'high'
    : lower.includes('next week') || lower.includes('soon')
      ? 'medium'
      : 'low'

  const deadline = extractDeadline(lower, today)

  const preferredFormat: LearningFormat | undefined = lower.includes('in person')
    ? 'in-person'
    : lower.includes('online') || lower.includes('zoom') || lower.includes('call')
      ? 'online'
      : undefined

  if (!module) uncertain.push('module')
  if (!topics.length) uncertain.push('topics')

  return {
    moduleId: module?.moduleId,
    moduleName: module?.moduleName,
    topics,
    urgency,
    deadline,
    preferredFormat,
    duration: extractDuration(lower),
    uncertain,
  }
}

/** "30 min", "45 minutes", "an hour", "1.5 hours", "2 hr" -> minutes. */
export function extractDuration(lower: string): number | undefined {
  if (/\bhalf an hour\b|\bhalf hour\b/.test(lower)) return 30
  if (/\ban hour\b|\b1 hour\b|\bone hour\b/.test(lower)) return 60
  const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/)
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60)
  const minMatch = lower.match(/(\d+)\s*(?:minutes?|mins?)\b/)
  if (minMatch) return parseInt(minMatch[1], 10)
  return undefined
}

/** Every weekday name mentioned in the text, with its character position. */
function weekdayMentions(lower: string): { index: number; pos: number }[] {
  const mentions: { index: number; pos: number }[] = []
  WEEKDAYS.forEach((name, index) => {
    const pos = lower.indexOf(name)
    if (pos !== -1) mentions.push({ index, pos })
  })
  return mentions
}

/**
 * A sentence like "test on Friday, I'm free Wednesday after 5pm" names two
 * different weekdays for two different purposes. Picking "the first weekday
 * in Sun-Sat order" (as a naive scan does) would silently return Wednesday
 * for BOTH the deadline and the availability question, which is wrong for
 * the deadline. Instead: with only one day mentioned, use it; with more than
 * one, pick whichever sits closest to a word that signals what it's for
 * ("test"/"due" for a deadline, "free"/"available" for availability), and
 * fall back to whichever day appears first in the sentence if no such word
 * is present at all.
 */
function pickWeekday(lower: string, contextWords: string[]): number | undefined {
  const mentions = weekdayMentions(lower)
  if (!mentions.length) return undefined
  if (mentions.length === 1) return mentions[0].index

  let anchorPos = -1
  for (const word of contextWords) {
    const pos = lower.indexOf(word)
    if (pos !== -1 && (anchorPos === -1 || pos < anchorPos)) anchorPos = pos
  }
  if (anchorPos === -1) return [...mentions].sort((a, b) => a.pos - b.pos)[0].index

  return mentions.reduce((best, m) => (Math.abs(m.pos - anchorPos) < Math.abs(best.pos - anchorPos) ? m : best)).index
}

const DEADLINE_WORDS = ['test', 'exam', 'due', 'deadline', 'assessment', 'quiz', 'by']
const AVAILABILITY_WORDS = ['free', 'available', 'availability', 'works for me', 'can do']

/**
 * Resolves "friday", "next monday", "tomorrow" to an ISO date.
 * Exported so the AI-assisted parser (backend/src/ai.ts) can reuse the same
 * tested weekday math for the date phrase Claude extracts — date arithmetic
 * is exactly the kind of thing worth keeping deterministic rather than
 * trusting to a model.
 */
export function extractDeadline(lower: string, today: Date): string | undefined {
  if (lower.includes('tomorrow')) return toIso(addDays(today, 1))

  const dayIndex = pickWeekday(lower, DEADLINE_WORDS)
  if (dayIndex === undefined) return undefined

  let delta = (dayIndex - today.getDay() + 7) % 7
  if (delta === 0) delta = 7 // "friday" said on a Friday means the next one
  if (lower.includes(`next ${WEEKDAYS[dayIndex]}`) && delta < 7) delta += 7
  return toIso(addDays(today, delta))
}

export interface AvailabilityHint {
  day: Weekday
  /** "HH:MM", 24h. Present only when the text names a time bound ("after 5pm", "before noon"). */
  startTime?: string
  endTime?: string
}

/**
 * Reads a free-text availability window like "free Wednesday after 5pm" or
 * "available before 3pm on Friday" into a concrete day + time bound. Purely
 * keyword/regex based — same reasoning as the rest of this file: a phrase
 * this structured doesn't need a model call to parse reliably, and a
 * deterministic result is one a student can trust and edit with confidence.
 * Requires an explicit availability word ("free", "available", ...) so a
 * lone deadline day ("my test is on Friday") is never mistaken for an
 * availability window.
 */
export function extractAvailability(lower: string): AvailabilityHint | undefined {
  if (!AVAILABILITY_WORDS.some((w) => lower.includes(w))) return undefined

  const dayIndex = pickWeekday(lower, AVAILABILITY_WORDS)
  if (dayIndex === undefined) return undefined
  const day = WEEKDAY_ABBR[dayIndex]

  const afterMatch = lower.match(/after (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
  const beforeMatch = lower.match(/before (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)

  let startTime = afterMatch ? toClockTime(afterMatch) : undefined
  let endTime = beforeMatch ? toClockTime(beforeMatch) : undefined
  if (startTime && !endTime) endTime = '23:00'
  if (endTime && !startTime) startTime = '06:00'

  return { day, startTime, endTime }
}

/** ["5", "30", "pm"] -> "17:30". No am/pm stated and hour <= 7 assumes evening, matching how students actually talk about after-school time. */
function toClockTime(match: RegExpMatchArray): string {
  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const period = match[3]
  if (period === 'pm' && hour < 12) hour += 12
  else if (period === 'am' && hour === 12) hour = 0
  else if (!period && hour <= 7) hour += 12
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Local-time YYYY-MM-DD. Deliberately not `toISOString`, which formats in UTC
 * and would report the previous day for anyone east of Greenwich.
 */
function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
