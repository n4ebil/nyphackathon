'use strict'

/**
 * Server-side port of shared/matching.ts, running in AWS Lambda instead of
 * the browser. Weights, thresholds and wording are kept byte-for-byte
 * identical to the original so the score a student sees never changes
 * depending on whether it came from the local (dev) or AWS (deployed) path.
 *
 * One deliberate difference: the original `scoreModule` calls
 * `areRelatedModules(subject.moduleId, request.moduleId)` from shared/nyp.ts.
 * That table lives in the frontend bundle already, so rather than duplicate
 * (and risk drifting from) it here, the caller is expected to precompute a
 * `moduleRelation` field on each teaching-subject row before calling this
 * Lambda:
 *   'exact'   - subject.moduleId === request.moduleId
 *   'related' - areRelatedModules(subject.moduleId, request.moduleId)
 *   'none'    - otherwise
 * See src/lib/match.js (frontend) for where this is computed.
 */

const WEIGHTS = {
  module: 35,
  topics: 20,
  availability: 20,
  format: 10,
  experience: 5,
  reliability: 10,
}

const AVAILABILITY_TARGET_MINUTES = 120
const MIN_RECOMMENDED_SCORE = 40

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function fromMinutes(total) {
  const h = String(Math.floor(total / 60)).padStart(2, '0')
  const m = String(total % 60).padStart(2, '0')
  return `${h}:${m}`
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

function overlappingSlots(a, b) {
  const shared = []
  for (const slotA of a) {
    for (const slotB of b) {
      if (slotA.day !== slotB.day) continue
      const start = Math.max(toMinutes(slotA.startTime), toMinutes(slotB.startTime))
      const end = Math.min(toMinutes(slotA.endTime), toMinutes(slotB.endTime))
      if (end - start < 30) continue
      shared.push({ userId: 'shared', day: slotA.day, startTime: fromMinutes(start), endTime: fromMinutes(end) })
    }
  }
  return shared
}

function slotMinutes(slots) {
  return slots.reduce((sum, s) => sum + (toMinutes(s.endTime) - toMinutes(s.startTime)), 0)
}

function scoreModule(request, subject) {
  if (subject.moduleId === request.moduleId) {
    return {
      label: 'Module compatibility',
      earned: WEIGHTS.module,
      max: WEIGHTS.module,
      detail: `Teaches ${subject.moduleName} — the exact competency you need`,
    }
  }
  if (subject.moduleRelation === 'related') {
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

function scoreTopics(request, subject) {
  const wanted = request.topics || []
  const covered = wanted.filter((topic) => (subject.topics || []).some((t) => t.toLowerCase() === topic.toLowerCase()))
  if (!wanted.length) {
    return {
      covered,
      factor: { label: 'Topic compatibility', earned: 0, max: WEIGHTS.topics, detail: 'No specific topics requested' },
    }
  }
  const confidenceFactor = 0.8 + 0.2 * ((subject.confidence || 0) / 5)
  const earned = Math.round(WEIGHTS.topics * (covered.length / wanted.length) * confidenceFactor)
  return {
    covered,
    factor: {
      label: 'Topic compatibility',
      earned,
      max: WEIGHTS.topics,
      detail: covered.length
        ? `Covers ${covered.length}/${wanted.length} of your topics (${covered.join(', ')}) · confidence ${subject.confidence}/5`
        : 'Does not list any of your topics',
    },
  }
}

function scoreAvailability(shared) {
  const minutes = slotMinutes(shared)
  const earned = Math.round(WEIGHTS.availability * Math.min(minutes / AVAILABILITY_TARGET_MINUTES, 1))
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

function scoreFormat(want, tutor) {
  const label = 'Learning format'
  if (want === tutor) {
    return { label, earned: WEIGHTS.format, max: WEIGHTS.format, detail: `You both prefer ${want} sessions` }
  }
  if (want === 'either' || tutor === 'either') {
    return {
      label,
      earned: 7,
      max: WEIGHTS.format,
      detail: `Flexible — ${tutor === 'either' ? 'they are' : 'you are'} happy either way`,
    }
  }
  return { label, earned: 0, max: WEIGHTS.format, detail: `You want ${want}, they prefer ${tutor}` }
}

function scoreExperience(subject) {
  const experience = subject.experience || 0
  const earned = Math.round(WEIGHTS.experience * Math.min(experience / 5, 1))
  return {
    label: 'Tutor experience',
    earned,
    max: WEIGHTS.experience,
    detail: experience ? `Has tutored this module ${experience} time${experience === 1 ? '' : 's'}` : 'New to tutoring this module',
  }
}

function scoreReliability(stats) {
  const label = 'Tutor reliability'
  if (!stats || stats.isNew) {
    return {
      label,
      earned: WEIGHTS.reliability,
      max: WEIGHTS.reliability,
      detail: 'New tutor — no completed sessions yet, so this counts full rather than against them',
    }
  }
  const ratingPart = stats.avgRating != null ? (stats.avgRating / 5) * 8 : 8
  const responsePart = stats.responseRate != null ? (stats.responseRate / 100) * 2 : 2
  const earned = Math.round(ratingPart + responsePart)
  const bits = []
  if (stats.avgRating != null) bits.push(`${stats.avgRating}/5 from ${stats.ratingCount} review${stats.ratingCount === 1 ? '' : 's'}`)
  if (stats.sessionsCompleted) bits.push(`${stats.sessionsCompleted} session${stats.sessionsCompleted === 1 ? '' : 's'} completed`)
  if (stats.responseRate != null) bits.push(`responds to ${stats.responseRate}% of requests`)
  return {
    label,
    earned: Math.min(earned, WEIGHTS.reliability),
    max: WEIGHTS.reliability,
    detail: bits.length ? bits.join(' · ') : 'No feedback yet',
  }
}

function scoreMatch(input) {
  const shared = overlappingSlots(input.studentSlots, input.tutorSlots)
  const topics = scoreTopics(input.request, input.tutorSubject)
  const breakdown = [
    scoreModule(input.request, input.tutorSubject),
    topics.factor,
    scoreAvailability(shared),
    scoreFormat(input.request.preferredFormat, input.tutor.preferredFormat),
    scoreExperience(input.tutorSubject),
    scoreReliability(input.tutorStats),
  ]
  return {
    score: breakdown.reduce((sum, f) => sum + f.earned, 0),
    breakdown,
    sharedSlots: shared,
    coveredTopics: topics.covered,
  }
}

function scoreLabel(score) {
  if (score >= 80) return 'Excellent Match'
  if (score >= 60) return 'Good Match'
  if (score >= 40) return 'Possible Match'
  return 'Not recommended'
}

function findReciprocal(tutor, input) {
  const tutorNeeds = (input.openRequests || []).filter((r) => r.userId === tutor.userId)
  for (const need of tutorNeeds) {
    const canTeach = (input.studentTeaches || []).find((s) => s.moduleId === need.moduleId)
    if (canTeach) return { moduleName: canTeach.moduleName }
  }
  return undefined
}

function findMatches(input) {
  const matches = []

  for (const tutor of input.candidates) {
    if (tutor.userId === input.student.userId) continue

    const subjects = input.teachingSubjects.filter((s) => s.userId === tutor.userId)
    if (!subjects.length) continue

    const tutorSlots = input.availability.filter((a) => a.userId === tutor.userId)
    const tutorStats = input.tutorStats ? input.tutorStats[tutor.userId] : undefined
    let best = null
    for (const subject of subjects) {
      const result = scoreMatch({
        request: input.request,
        student: input.student,
        studentSlots: input.studentSlots,
        tutor,
        tutorSubject: subject,
        tutorSlots,
        tutorStats,
      })
      if (!best || result.score > best.score) best = Object.assign({}, result, { subject })
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
      tutorStats,
      status: 'suggested',
      explanation: undefined,
    })
  }

  return matches.sort((a, b) => b.score - a.score)
}

function joinList(items) {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function buildExplanation(match, request) {
  const ratio = (label) => {
    const factor = match.breakdown.find((f) => f.label === label)
    return factor ? factor.earned / factor.max : 0
  }

  const name = match.tutor.name
  const label = scoreLabel(match.score).toLowerCase()
  const article = /^[aeiou]/.test(label) ? 'an' : 'a'
  const opener =
    match.score >= MIN_RECOMMENDED_SCORE
      ? `${name} is ${article} ${label} for ${request.moduleName}.`
      : `${name} is not a strong match for ${request.moduleName}.`

  const strengths = []
  if (ratio('Module compatibility') === 1) strengths.push(`teach ${request.moduleName} directly`)
  else if (ratio('Module compatibility') > 0) strengths.push('teach a closely related module')

  const topics = match.coveredTopics
  if (topics.length === request.topics.length && topics.length) strengths.push(`cover every topic you asked about (${topics.join(', ')})`)
  else if (topics.length) strengths.push(`cover ${topics.length} of your ${request.topics.length} topics (${topics.join(', ')})`)

  if (ratio('Availability overlap') === 1) strengths.push('have plenty of free time in common with you')
  else if (ratio('Availability overlap') > 0) strengths.push('share some free time with you')

  if (ratio('Learning format') === 1) strengths.push('prefer the same session format as you')
  if (match.tutorStats && match.tutorStats.avgRating && match.tutorStats.avgRating >= 4.5)
    strengths.push(`have a strong track record (${match.tutorStats.avgRating}/5 from past students)`)

  const caveats = []
  if (ratio('Availability overlap') === 0) caveats.push('you have no overlapping free time yet')
  else if (ratio('Learning format') === 0) caveats.push(`they prefer ${match.tutor.preferredFormat} sessions rather than ${request.preferredFormat}`)
  else if (ratio('Tutor experience') < 0.5) caveats.push('they are relatively new to tutoring this module')

  const sentences = [opener]
  if (strengths.length) sentences.push(`They ${joinList(strengths.slice(0, 3))}.`)
  if (caveats.length) sentences.push(`Worth knowing: ${caveats[0]}.`)
  if (match.reciprocal) sentences.push(`You could also help them with ${match.reciprocal.moduleName}, so this works both ways.`)
  return sentences.join(' ')
}

module.exports = {
  WEIGHTS,
  MIN_RECOMMENDED_SCORE,
  overlappingSlots,
  scoreMatch,
  scoreLabel,
  findMatches,
  buildExplanation,
}
