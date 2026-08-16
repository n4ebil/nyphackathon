import { getGenerativeModel, Schema } from 'firebase/ai'
import { ai } from '../firebase.js'
import { modulesForCourse } from '../shared/nyp.ts'

/**
 * Scoped the same way the original project's Claude integration was scoped:
 * AI only picks *which competency in the student's own course* a free-text
 * request is about — the one part of parsing that genuinely needs language
 * understanding. Topics, urgency and the deadline's weekday math stay local
 * and deterministic in shared/nlp.ts (see src/lib/match.js).
 */

function getModel(names) {
  if (!ai) return null
  return getGenerativeModel(ai, {
    model: 'gemini-flash-latest',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: {
          moduleName: Schema.enumString({ enum: [...names, 'None of these'] }),
        },
      }),
    },
  })
}

/** Returns the matching ModuleInfo from the student's course, or null (AI unavailable, no clear match, or the call failed). */
export async function pickModuleWithAI(text, course) {
  if (!course) return null
  const candidates = modulesForCourse(course)
  if (!candidates.length) return null

  try {
    const names = candidates.map((c) => c.moduleName)
    const model = getModel(names)
    if (!model) return null

    const result = await model.generateContent(
      `A student on "${course}" wrote this help request:\n"${text}"\n\n` +
        `Which ONE of these competencies from their own course is it about? ` +
        `Pick "None of these" unless one is a clear match.\n\n` +
        names.map((n) => `- ${n}`).join('\n'),
    )
    const parsed = JSON.parse(result.response.text())
    return candidates.find((c) => c.moduleName === parsed.moduleName) || null
  } catch (err) {
    console.error('AI module parsing unavailable, falling back to local parser.', err)
    return null
  }
}
