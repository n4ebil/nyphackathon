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

const PLAN_SCHEMA = Schema.object({
  properties: {
    goal: Schema.string(),
    blocks: Schema.array({
      items: Schema.object({
        properties: {
          label: Schema.string(),
          description: Schema.string(),
        },
      }),
    }),
  },
})

function getPlanModel() {
  if (!ai) return null
  return getGenerativeModel(ai, {
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', responseSchema: PLAN_SCHEMA },
  })
}

/**
 * A short, timeboxed plan for one tutoring session — draft only, the tutor
 * edits it before the session. Falls back to a deterministic template
 * (scaled to the requested duration) whenever Gemini is unavailable, so this
 * never blocks the flow.
 */
export async function generateSessionPlan({ moduleName, topics, description, durationMinutes }) {
  const duration = durationMinutes || 60
  try {
    const model = getPlanModel()
    if (!model) return templatePlan(moduleName, topics, duration)

    const result = await model.generateContent(
      `Draft a short peer-tutoring session plan for "${moduleName}".\n` +
        `Topics to cover: ${topics.join(', ') || 'not specified'}.\n` +
        `Student's own description of what they need: "${description}"\n` +
        `Session length: ${duration} minutes.\n\n` +
        `Return a one-sentence "goal" for the session, and 3-5 timeboxed "blocks" ` +
        `(label like "0-10 min", description of what happens) that fit within ${duration} minutes total. ` +
        `Keep it concrete and specific to the topics, not generic study advice.`,
    )
    const parsed = JSON.parse(result.response.text())
    if (!parsed.blocks?.length) return templatePlan(moduleName, topics, duration)
    return { goal: parsed.goal, blocks: parsed.blocks, generatedBy: 'ai' }
  } catch (err) {
    console.error('AI session plan unavailable, falling back to a template.', err)
    return templatePlan(moduleName, topics, duration)
  }
}

function templatePlan(moduleName, topics, duration) {
  const topicList = topics.length ? topics.join(', ') : moduleName
  const warmup = Math.round(duration * 0.15)
  const core = Math.round(duration * 0.6)
  const practice = Math.round(duration * 0.15)
  const wrap = Math.max(duration - warmup - core - practice, 5)
  let t = 0
  const block = (mins, description) => {
    const b = { label: `${t}-${t + mins} min`, description }
    t += mins
    return b
  }
  return {
    goal: `Get comfortable with ${topicList}`,
    blocks: [
      block(warmup, `Quick check-in on what's already understood about ${topicList} and where it's breaking down`),
      block(core, `Work through ${topicList} together, tutor explaining and student attempting each step`),
      block(practice, `Student tries a similar problem alone while the tutor observes`),
      block(wrap, `Recap the key steps and note anything to revisit before the next session`),
    ],
    generatedBy: 'template',
  }
}
