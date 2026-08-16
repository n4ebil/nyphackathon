import { findMatches, buildExplanation } from '../shared/matching.ts'
import { parseHelpRequest } from '../shared/nlp.ts'
import { MODULES, modulesForCourse } from '../shared/nyp.ts'
import { pickModuleWithAI } from './ai.js'
import {
  createLearningRequest,
  getAvailability,
  listAllAvailability,
  listAllLearningRequests,
  listAllTeachingSubjects,
  listUsers,
} from './firestore.js'

/**
 * Parses free text into a learning request and saves it to Firestore.
 * AI (Gemini, if configured) picks the competency; everything else — topics,
 * urgency, deadline — is the local deterministic parser in shared/nlp.ts.
 */
export async function submitLearningRequest(student, text) {
  const parsed = parseHelpRequest(text, student.course)
  const aiModule = await pickModuleWithAI(text, student.course)
  const fallback = modulesForCourse(student.course)[0] || MODULES[0]

  const chosen =
    aiModule || (parsed.moduleId ? MODULES.find((m) => m.moduleId === parsed.moduleId) : null) || fallback

  // Topics depend on which module ended up chosen — recompute against its own
  // vocabulary so they always describe the module actually being requested.
  const lower = text.toLowerCase()
  const topics = chosen.topics.filter((t) => lower.includes(t.toLowerCase()))

  const request = {
    userId: student.userId,
    moduleId: chosen.moduleId,
    moduleName: chosen.moduleName,
    topics: topics.length ? topics : chosen.topics.slice(0, 2),
    description: text,
    urgency: parsed.urgency,
    deadline: parsed.deadline || null,
    preferredFormat: parsed.preferredFormat || student.preferredFormat || 'either',
    createdAt: new Date().toISOString(),
    parsedBy: aiModule ? 'ai' : 'local',
  }
  return createLearningRequest(request)
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
