import { MODULES } from './nyp.ts'
import type {
  AvailabilitySlot,
  LearningRequest,
  MatchRequest,
  TeachingSubject,
  User,
} from './types.ts'

/**
 * Made-up students for the demo. NYP's real schools, diplomas and the
 * competencies each diploma covers live in `nyp.ts` — keep this file for
 * records that only exist to make the demo run.
 *
 * Tuned so the 60-second demo lands: "I need help with SQL joins before my test
 * on Friday" -> Sarah Lim at 96%.
 */

/**
 * Look up a competency's id by name rather than hardcoding slugs, so this file
 * cannot silently drift from the catalog in `nyp.ts` — if a competency name
 * gets renamed there, this throws instead of quietly matching nothing.
 */
function competency(name: string): string {
  const module = MODULES.find((m) => m.moduleName === name)
  if (!module) throw new Error(`Unknown competency "${name}" — check DIPLOMA_COMPETENCIES in nyp.ts`)
  return module.moduleId
}

/** The signed-in student for the demo. */
export const CURRENT_USER_ID = 'u-aaron'

export const USERS: User[] = [
  {
    userId: 'u-aaron',
    name: 'Aaron Tan',
    adminNo: '231045A',
    email: '231045a@mymail.nyp.edu.sg',
    course: 'Diploma in Computing',
    year: 2,
    bio: 'Year 2 Computing. Comfortable with Python, still finding my feet with databases.',
    preferredFormat: 'in-person',
  },
  {
    userId: 'u-sarah',
    name: 'Sarah Lim',
    adminNo: '221187C',
    email: '221187c@mymail.nyp.edu.sg',
    course: 'Diploma in Applied AI & Analytics',
    year: 3,
    bio: 'Year 3 Applied AI & Analytics. I like explaining database design with ER diagrams and worked examples.',
    preferredFormat: 'in-person',
  },
  {
    userId: 'u-danial',
    name: 'Danial Rahim',
    adminNo: '211203B',
    email: '211203b@mymail.nyp.edu.sg',
    course: 'Diploma in Cybersecurity & Digital Forensics',
    year: 3,
    bio: 'Year 3 CDF. Been a lab helper for two semesters. Prefer screen-share sessions.',
    preferredFormat: 'online',
  },
  {
    userId: 'u-priya',
    name: 'Priya Nair',
    adminNo: '221094D',
    email: '221094d@mymail.nyp.edu.sg',
    course: 'Diploma in Business & Financial Technology',
    year: 3,
    bio: 'Year 3 BFT. Happy to walk through query plans and statistics problems.',
    preferredFormat: 'either',
  },
  {
    userId: 'u-weijie',
    name: 'Ng Wei Jie',
    adminNo: '231156E',
    email: '231156e@mymail.nyp.edu.sg',
    course: 'Diploma in Computing',
    year: 2,
    bio: 'Year 2 Computing. Ask me about clean code and version control.',
    preferredFormat: 'online',
  },
]

export const TEACHING_SUBJECTS: TeachingSubject[] = [
  {
    userId: 'u-aaron',
    moduleId: competency('Programming'),
    moduleName: 'Programming',
    topics: ['recursion', 'loops', 'functions', 'debugging'],
    confidence: 4,
    experience: 3,
  },
  {
    // Sarah's own diploma is Applied AI & Analytics, not Computing — she picked
    // this up outside her core competencies, which is exactly the kind of
    // match a formal module list alone would miss.
    userId: 'u-sarah',
    moduleId: competency('Database Systems'),
    moduleName: 'Database Systems',
    topics: ['SQL joins', 'subqueries', 'normalisation', 'ER modelling'],
    confidence: 5,
    experience: 1,
  },
  {
    userId: 'u-danial',
    moduleId: competency('Database Systems'),
    moduleName: 'Database Systems',
    topics: ['SQL joins', 'indexing', 'transactions'],
    confidence: 4,
    experience: 8,
  },
  {
    userId: 'u-priya',
    moduleId: competency('Database Systems'),
    moduleName: 'Database Systems',
    topics: ['SQL joins', 'normalisation', 'indexing'],
    confidence: 5,
    experience: 3,
  },
  {
    // This one IS on Priya's own diploma — Data Analytics is a Business &
    // Financial Technology competency.
    userId: 'u-priya',
    moduleId: competency('Data Analytics'),
    moduleName: 'Data Analytics',
    topics: ['probability', 'regression'],
    confidence: 4,
    experience: 2,
  },
  {
    userId: 'u-weijie',
    moduleId: competency('Software Development'),
    moduleName: 'Software Development',
    topics: ['OOP', 'design patterns', 'version control'],
    confidence: 5,
    experience: 5,
  },
]

export const AVAILABILITY: AvailabilitySlot[] = [
  // Aaron
  { userId: 'u-aaron', day: 'Mon', startTime: '14:00', endTime: '16:00' },
  { userId: 'u-aaron', day: 'Wed', startTime: '10:00', endTime: '12:00' },
  { userId: 'u-aaron', day: 'Thu', startTime: '15:00', endTime: '18:00' },
  // Sarah — full overlap with Aaron on Monday
  { userId: 'u-sarah', day: 'Mon', startTime: '13:00', endTime: '17:00' },
  { userId: 'u-sarah', day: 'Fri', startTime: '09:00', endTime: '11:00' },
  // Danial — Thursday only
  { userId: 'u-danial', day: 'Thu', startTime: '16:00', endTime: '18:00' },
  { userId: 'u-danial', day: 'Sat', startTime: '10:00', endTime: '13:00' },
  // Priya — a single shared hour
  { userId: 'u-priya', day: 'Wed', startTime: '11:00', endTime: '12:00' },
  { userId: 'u-priya', day: 'Fri', startTime: '14:00', endTime: '16:00' },
  // Wei Jie — no overlap with Aaron at all
  { userId: 'u-weijie', day: 'Tue', startTime: '09:00', endTime: '11:00' },
]

export const LEARNING_REQUESTS: LearningRequest[] = [
  {
    requestId: 'r-aaron-db',
    userId: 'u-aaron',
    moduleId: competency('Database Systems'),
    moduleName: 'Database Systems',
    topics: ['SQL joins', 'subqueries', 'normalisation'],
    description: 'I have a databases test on Friday and I keep mixing up LEFT and INNER joins.',
    urgency: 'high',
    deadline: '2026-08-21',
    preferredFormat: 'in-person',
  },
  {
    // Sarah needs what Aaron teaches -> mutual learning opportunity.
    requestId: 'r-sarah-prog',
    userId: 'u-sarah',
    moduleId: competency('Programming'),
    moduleName: 'Programming',
    topics: ['recursion', 'debugging'],
    description: 'Recursion still does not click for me, especially tracing the call stack.',
    urgency: 'medium',
    preferredFormat: 'in-person',
  },
]

export const MATCH_REQUESTS: MatchRequest[] = [
  {
    matchId: 'r-priya-prog--u-aaron',
    studentId: 'u-priya',
    tutorId: 'u-aaron',
    moduleName: 'Programming',
    message: 'Could you help me trace a recursive function before Thursday?',
    status: 'pending',
    createdAt: '2026-08-15T09:24:00Z',
  },
]
