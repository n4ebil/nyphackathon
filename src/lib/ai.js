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

const GOAL_SCHEMA = Schema.object({
  properties: {
    goal: Schema.string(),
  },
})

function getGoalModel() {
  if (!ai) return null
  return getGenerativeModel(ai, {
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', responseSchema: GOAL_SCHEMA },
  })
}

/**
 * The one part of natural-language request parsing that genuinely needs a
 * model rather than keyword matching: turning a free-text ask into a short,
 * specific learning goal ("Understand insertion and deletion in linked
 * lists") instead of restating the topic list. Everything else in the
 * natural-language flow (module, urgency, deadline, availability, format)
 * stays local and deterministic — see shared/nlp.ts — for the same reason
 * `pickModuleWithAI` above is scoped narrowly: a number a student relies on
 * should be reproducible, but a one-line paraphrase is exactly what a model
 * is for.
 *
 * Swapping this for Amazon Bedrock later only means replacing the body of
 * this function — callers just await a goal string either way.
 */
export async function generateLearningGoal({ text, moduleName, topics }) {
  const fallback = topics.length ? `Get comfortable with ${topics.join(', ')}` : `Get help with ${moduleName}`
  try {
    const model = getGoalModel()
    if (!model) return fallback

    const result = await model.generateContent(
      `A student wrote this help request: "${text}"\n` +
        `It's been matched to the competency "${moduleName}"${topics.length ? ` (topics: ${topics.join(', ')})` : ''}.\n\n` +
        `In one short sentence (under 12 words), what specifically do they want to achieve? ` +
        `Be concrete, not generic — e.g. "Understand insertion and deletion in linked lists", not "Learn the topic better".`,
    )
    const parsed = JSON.parse(result.response.text())
    return parsed.goal?.trim() || fallback
  } catch (err) {
    console.error('AI goal generation unavailable, falling back to a template.', err)
    return fallback
  }
}

const PLAN_SCHEMA = Schema.object({
  properties: {
    warmup: Schema.string(),
    concepts: Schema.string(),
    practice: Schema.string(),
    questions: Schema.string(),
    recap: Schema.string(),
  },
})

function getPlanModel() {
  if (!ai) return null
  return getGenerativeModel(ai, {
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', responseSchema: PLAN_SCHEMA },
  })
}

const STAGES = [
  ['warmup', 'Warm-up & Review', 0.15],
  ['concepts', 'Main Concepts', 0.35],
  ['practice', 'Practice Activity', 0.25],
  ['questions', 'Questions', 0.15],
  ['recap', 'Final Recap', 0.1],
]

/** Splits the session length across the five fixed stages — deterministic on purpose, same reasoning as the rest of this file: a number a tutor plans a real session around should be reproducible, not something a model can drift on. */
function buildBlocks(duration, content) {
  const blocks = []
  let elapsed = 0
  STAGES.forEach(([stage, title, share], i) => {
    const isLast = i === STAGES.length - 1
    const mins = isLast ? Math.max(duration - elapsed, 5) : Math.round(duration * share)
    blocks.push({ stage, title, label: `${elapsed}-${elapsed + mins} min`, description: content[stage] })
    elapsed += mins
  })
  return blocks
}

/**
 * A short, structured plan for one tutoring session, built around the
 * student's actual module/topics/goal — draft only, the tutor edits it
 * before the session. AI fills in the five stages' content; the time split
 * is always computed the same deterministic way (see buildBlocks) so the
 * numbers stay trustworthy even though the wording doesn't. Falls back to a
 * template whenever Gemini is unavailable, so this never blocks the flow.
 */
export async function generateSessionPlan({ moduleName, topics, description, goal, durationMinutes }) {
  const duration = durationMinutes || 60
  const sessionGoal = goal || (topics.length ? `Get comfortable with ${topics.join(', ')}` : `Get help with ${moduleName}`)

  try {
    const model = getPlanModel()
    if (!model) return templatePlan({ moduleName, topics, goal: sessionGoal, duration })

    const result = await model.generateContent(
      `Draft content for a peer-tutoring session on "${moduleName}".\n` +
        `Topics to cover: ${topics.join(', ') || 'not specified'}.\n` +
        `Student's learning goal: "${sessionGoal}"\n` +
        `Student's own description of what they need: "${description || 'not given'}"\n` +
        `Session length: ${duration} minutes.\n\n` +
        `Write 1-2 concrete, specific sentences (not generic study advice) for each of these five stages:\n` +
        `- warmup: a quick check on what the student already understands\n` +
        `- concepts: the core explanation, specific to the topics above\n` +
        `- practice: a hands-on exercise the student does during the session\n` +
        `- questions: prompts for the student to attempt or ask about on their own\n` +
        `- recap: what to reinforce before ending`,
    )
    const parsed = JSON.parse(result.response.text())
    if (!parsed.concepts) return templatePlan({ moduleName, topics, goal: sessionGoal, duration })
    return { goal: sessionGoal, blocks: buildBlocks(duration, parsed), generatedBy: 'ai' }
  } catch (err) {
    console.error('AI session plan unavailable, falling back to a template.', err)
    return templatePlan({ moduleName, topics, goal: sessionGoal, duration })
  }
}

function templatePlan({ moduleName, topics, goal, duration }) {
  const topicList = topics.length ? topics.join(', ') : moduleName
  const content = {
    warmup: `Quick check-in on what's already understood about ${topicList} and where it's breaking down`,
    concepts: `Walk through ${topicList} together, tutor explaining and student attempting each step`,
    practice: `Student works through a practice problem on ${topicList} while the tutor observes`,
    questions: `Student asks about anything unclear and attempts a question on ${topicList} solo`,
    recap: `Recap the key steps in ${topicList} and note anything to revisit next time`,
  }
  return { goal, blocks: buildBlocks(duration, content), generatedBy: 'template' }
}
