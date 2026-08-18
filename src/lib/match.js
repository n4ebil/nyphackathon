import { findMatches, buildExplanation } from '../shared/matching.ts'
import { extractAvailability, parseHelpRequest } from '../shared/nlp.ts'
import { MODULES, modulesForCourse } from '../shared/nyp.ts'
import { computeTutorStats } from '../shared/reliability.ts'
import { generateLearningGoal, pickModuleWithAI } from './ai.js'
import {
  createClassRequest,
  createLearningRequest,
  getAvailability,
  listAllAvailability,
  listAllFeedback,
  listAllLearningRequests,
  listAllMatchRequests,
  listAllSessions,
  listAllTeachingSubjects,
  listUsers,
} from './firestore.js'

/**
 * Shared by both request flows below: AI (Gemini, if configured) picks the
 * competency; topics are recomputed against whichever module actually got
 * chosen, so they always describe that module rather than the local
 * heuristic parser's (possibly different) first guess.
 */
async function resolveModuleAndTopics(student, text) {
  const parsed = parseHelpRequest(text, student.course)
  const aiModule = await pickModuleWithAI(text, student.course)
  const fallback = modulesForCourse(student.course)[0] || MODULES[0]

  const chosen =
    aiModule || (parsed.moduleId ? MODULES.find((m) => m.moduleId === parsed.moduleId) : null) || fallback

  const lower = text.toLowerCase()
  const topics = chosen.topics.filter((t) => lower.includes(t.toLowerCase()))

  return {
    moduleId: chosen.moduleId,
    moduleName: chosen.moduleName,
    topics: topics.length ? topics : chosen.topics.slice(0, 2),
    parsed,
    parsedBy: aiModule ? 'ai' : 'local',
  }
}

/**
 * Parses free text into the structured fields a learning request needs,
 * without saving anything — lets the UI show an editable review step first.
 */
export async function previewLearningRequest(student, text) {
  const { moduleId, moduleName, topics, parsed, parsedBy } = await resolveModuleAndTopics(student, text)
  return {
    moduleId,
    moduleName,
    topics,
    description: text,
    urgency: parsed.urgency,
    deadline: parsed.deadline || null,
    preferredFormat: parsed.preferredFormat || student.preferredFormat || 'either',
    duration: parsed.duration || 60,
    parsedBy,
  }
}

/**
 * Full natural-language understanding for the "describe what you need" flow
 * on Find Tutors: module/topics (AI-assisted, see resolveModuleAndTopics),
 * urgency/deadline/format/duration/availability (local, deterministic —
 * shared/nlp.ts), and a one-line learning goal (AI, see generateLearningGoal
 * in lib/ai.js). Nothing is saved here; the UI shows this back to the
 * student to confirm or edit before it drives a search.
 */
export async function previewNaturalLanguageRequest(student, text) {
  const { moduleId, moduleName, topics, parsed, parsedBy } = await resolveModuleAndTopics(student, text)
  const availability = extractAvailability(text.toLowerCase())
  const goal = await generateLearningGoal({ text, moduleName, topics })

  return {
    moduleId,
    moduleName,
    topics,
    description: text,
    goal,
    urgency: parsed.urgency,
    deadline: parsed.deadline || null,
    availability,
    preferredFormat: parsed.preferredFormat || student.preferredFormat || 'either',
    duration: parsed.duration || 60,
    parsedBy,
  }
}

/**
 * Saves a learning request. `fields` is normally the (possibly student-edited)
 * output of `previewLearningRequest` — falls back to parsing `text` itself if
 * the caller skips the review step.
 */
export async function submitLearningRequest(student, text, fields) {
  const resolved = fields || (await previewLearningRequest(student, text))
  const request = {
    userId: student.userId,
    moduleId: resolved.moduleId,
    moduleName: resolved.moduleName,
    topics: resolved.topics,
    description: resolved.description ?? text,
    urgency: resolved.urgency,
    deadline: resolved.deadline || null,
    preferredFormat: resolved.preferredFormat || student.preferredFormat || 'either',
    duration: resolved.duration || 60,
    goal: resolved.goal || null,
    createdAt: new Date().toISOString(),
    parsedBy: resolved.parsedBy || 'local',
  }
  return createLearningRequest(request)
}

/** Parses free text into a class request (Schedule page) and saves it to Firestore. */
export async function submitClassRequest(student, text) {
  const { moduleId, moduleName, topics, parsedBy } = await resolveModuleAndTopics(student, text)

  const request = {
    studentId: student.userId,
    studentName: student.name || student.email,
    moduleId,
    moduleName,
    topics,
    description: text,
    status: 'collecting',
    createdAt: new Date().toISOString(),
    parsedBy,
  }
  return createClassRequest(request)
}

/** Ranks every other user against one learning request, using the shared deterministic scoring model. */
export async function computeMatches(student, request) {
  const [candidates, teachingSubjects, availability, studentSlots, openRequests, feedback, sessions, matchRequests] =
    await Promise.all([
      listUsers(),
      listAllTeachingSubjects(),
      listAllAvailability(),
      getAvailability(student.userId),
      listAllLearningRequests(),
      listAllFeedback(),
      listAllSessions(),
      listAllMatchRequests(),
    ])

  const tutorStats = {}
  for (const tutor of candidates) {
    if (tutor.userId === student.userId) continue
    tutorStats[tutor.userId] = computeTutorStats({
      tutorId: tutor.userId,
      feedback,
      sessions,
      matchRequests,
      teachingSubjects,
    })
  }

  const matches = findMatches({
    student,
    request,
    studentSlots,
    candidates,
    teachingSubjects,
    availability,
    studentTeaches: teachingSubjects.filter((s) => s.userId === student.userId),
    openRequests,
    tutorStats,
  })

  return matches.map((match) => ({ ...match, explanation: buildExplanation(match, request) }))
}

/**
 * Top tutor matches for the Dashboard's "Recommended for you" section — the
 * exact same deterministic scoring as Find Tutors (computeMatches above),
 * run against a sensible default request (the student's most recent
 * learning request, or the first competency in their own course) so a real
 * match % can be shown without making the student search first.
 */
export async function computeRecommendedTutors(student, { limit = 3 } = {}) {
  const learningRequests = await listAllLearningRequests()
  const mine = learningRequests
    .filter((r) => r.userId === student.userId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  const fallback = modulesForCourse(student.course)[0] || MODULES[0]
  const moduleId = mine[0]?.moduleId || fallback?.moduleId
  if (!moduleId) return []
  const module = MODULES.find((m) => m.moduleId === moduleId) || fallback

  const request = {
    requestId: 'recommended',
    userId: student.userId,
    moduleId: module.moduleId,
    moduleName: module.moduleName,
    topics: mine[0]?.topics?.length ? mine[0].topics : module.topics,
    description: '',
    urgency: 'medium',
    deadline: null,
    preferredFormat: student.preferredFormat || 'either',
    duration: 60,
  }

  const matches = await computeMatches(student, request)
  return matches.slice(0, limit)
}
