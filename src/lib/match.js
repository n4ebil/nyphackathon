import { findMatches, buildExplanation } from '../shared/matching.ts'
import { parseHelpRequest } from '../shared/nlp.ts'
import { MODULES, modulesForCourse } from '../shared/nyp.ts'
import { pickModuleWithAI } from './ai.js'
import {
  createClassRequest,
  createLearningRequest,
  getAvailability,
  listAllAvailability,
  listAllLearningRequests,
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

/** Parses free text into a learning request and saves it to Firestore. */
export async function submitLearningRequest(student, text) {
  const { moduleId, moduleName, topics, parsed, parsedBy } = await resolveModuleAndTopics(student, text)

  const request = {
    userId: student.userId,
    moduleId,
    moduleName,
    topics,
    description: text,
    urgency: parsed.urgency,
    deadline: parsed.deadline || null,
    preferredFormat: parsed.preferredFormat || student.preferredFormat || 'either',
    createdAt: new Date().toISOString(),
    parsedBy,
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
  const [candidates, teachingSubjects, availability, studentSlots, openRequests] = await Promise.all([
    listUsers(),
    listAllTeachingSubjects(),
    listAllAvailability(),
    getAvailability(student.userId),
    listAllLearningRequests(),
  ])

  const matches = findMatches({
    student,
    request,
    studentSlots,
    candidates,
    teachingSubjects,
    availability,
    studentTeaches: teachingSubjects.filter((s) => s.userId === student.userId),
    openRequests,
  })

  return matches.map((match) => ({ ...match, explanation: buildExplanation(match, request) }))
}
