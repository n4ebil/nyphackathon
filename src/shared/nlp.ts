import { MODULES, modulesForCourse } from './nyp.ts'
import type { LearningFormat, Urgency } from './types.ts'

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
  /** Which parts the parser is unsure about, surfaced in the UI for confirmation. */
  uncertain: string[]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

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
    uncertain,
  }
}

/**
 * Resolves "friday", "next monday", "tomorrow" to an ISO date.
 * Exported so the AI-assisted parser (backend/src/ai.ts) can reuse the same
 * tested weekday math for the date phrase Claude extracts — date arithmetic
 * is exactly the kind of thing worth keeping deterministic rather than
 * trusting to a model.
 */
export function extractDeadline(lower: string, today: Date): string | undefined {
  if (lower.includes('tomorrow')) return toIso(addDays(today, 1))

  const dayIndex = WEEKDAYS.findIndex((d) => lower.includes(d))
  if (dayIndex === -1) return undefined

  let delta = (dayIndex - today.getDay() + 7) % 7
  if (delta === 0) delta = 7 // "friday" said on a Friday means the next one
  if (lower.includes(`next ${WEEKDAYS[dayIndex]}`) && delta < 7) delta += 7
  return toIso(addDays(today, delta))
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
