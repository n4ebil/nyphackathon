/** Shared domain types. These mirror the DynamoDB entities in the project plan. */

export type LearningFormat = 'in-person' | 'online' | 'either'
export type Urgency = 'low' | 'medium' | 'high'
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

export interface User {
  userId: string
  name: string
  /** NYP admin number, e.g. "231045A". This is how students identify each other. */
  adminNo: string
  /** NYP student mail, "<adminno>@mymail.nyp.edu.sg". */
  email: string
  /** Full diploma name, e.g. "Diploma in Information Technology". */
  course: string
  /** Year of study. NYP diplomas run three years. */
  year: 1 | 2 | 3
  bio: string
  preferredFormat: LearningFormat
}

export interface TeachingSubject {
  userId: string
  moduleId: string
  moduleName: string
  topics: string[]
  /** Self-rated confidence, 1-5. */
  confidence: number
  /** Times they have tutored this module, 0-10. */
  experience: number
}

export interface LearningRequest {
  requestId: string
  userId: string
  moduleId: string
  moduleName: string
  topics: string[]
  description: string
  urgency: Urgency
  /** ISO date, e.g. 2026-08-21. */
  deadline?: string
  preferredFormat: LearningFormat
}

export interface AvailabilitySlot {
  userId: string
  day: Weekday
  /** 24h "HH:MM". */
  startTime: string
  endTime: string
}

export interface ScoreFactor {
  label: string
  earned: number
  max: number
  /** Short human-readable reason shown in the breakdown. */
  detail: string
}

export interface Match {
  matchId: string
  studentId: string
  tutorId: string
  tutor: User
  moduleId: string
  moduleName: string
  score: number
  breakdown: ScoreFactor[]
  /** Requested topics this tutor covers, in the student's own wording. */
  coveredTopics: string[]
  /** Set when the pair can also teach each other something. */
  reciprocal?: { moduleName: string }
  sharedSlots: AvailabilitySlot[]
  status: 'suggested' | 'pending' | 'accepted' | 'rejected'
  /** Populated by Bedrock in phase 6; a local template stands in for now. */
  explanation?: string
}

export interface Session {
  sessionId: string
  matchId: string
  day: Weekday
  startTime: string
  endTime: string
  format: LearningFormat
  location: string
  status: 'arranged' | 'completed' | 'cancelled'
}

export interface Feedback {
  sessionId: string
  fromUser: string
  toUser: string
  rating: number
  comment: string
}

export interface MatchRequest {
  matchId: string
  studentId: string
  tutorId: string
  moduleName: string
  message: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}
