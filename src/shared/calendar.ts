import type { Weekday } from './types.ts'

const WEEKDAYS: Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * "Wed" + "14:00" -> the next real calendar Date that combination lands on.
 * Sessions only store a recurring weekday + time, not an absolute date, so
 * anything calendar-facing (Google Calendar link, .ics file) needs this same
 * conversion the Zoom backend already does server-side (functions/zoom.js) —
 * duplicated here rather than shared because one runs in the browser and the
 * other in a Cloud Function, with no code path between them.
 */
export function nextOccurrence(day: Weekday, time: string): Date {
  const targetDow = WEEKDAYS.indexOf(day)
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const delta = (targetDow - now.getDay() + 7) % 7
  const candidate = new Date(now)
  candidate.setDate(candidate.getDate() + delta)
  candidate.setHours(h, m, 0, 0)
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7)
  return candidate
}

/**
 * "Wed" + "14:00" -> the Date for that combination in the *current* week —
 * unlike nextOccurrence, this doesn't roll forward into next week if it's
 * already passed. Used to tell whether an arranged session's end time has
 * actually gone by yet (e.g. to close a message thread a few minutes after
 * a session ends), where nextOccurrence would always report it as upcoming.
 */
export function occurrenceThisWeek(day: Weekday, time: string): Date {
  const targetDow = WEEKDAYS.indexOf(day)
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const delta = targetDow - now.getDay()
  const candidate = new Date(now)
  candidate.setDate(candidate.getDate() + delta)
  candidate.setHours(h, m, 0, 0)
  return candidate
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYYMMDDTHHMMSS, local time — what both Google Calendar links and .ics files expect for a floating (no-timezone) event. */
function toCalTimestamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

export interface CalendarEventInput {
  title: string
  description: string
  location: string
  day: Weekday
  startTime: string
  endTime: string
}

function eventTimes(event: CalendarEventInput) {
  const start = nextOccurrence(event.day, event.startTime)
  const [eh, em] = event.endTime.split(':').map(Number)
  const end = new Date(start)
  end.setHours(eh, em, 0, 0)
  return { start, end }
}

export function googleCalendarUrl(event: CalendarEventInput): string {
  const { start, end } = eventTimes(event)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toCalTimestamp(start)}/${toCalTimestamp(end)}`,
    details: event.description,
    location: event.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function icsEscape(s: string): string {
  return s.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n')
}

function buildIcsFile(event: CalendarEventInput): string {
  const { start, end } = eventTimes(event)
  const now = new Date()
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NYPkaki//Session//EN',
    'BEGIN:VEVENT',
    `UID:${now.getTime()}@nypkaki`,
    `DTSTAMP:${toCalTimestamp(now)}`,
    `DTSTART:${toCalTimestamp(start)}`,
    `DTEND:${toCalTimestamp(end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(event.description)}`,
    `LOCATION:${icsEscape(event.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/** Apple Calendar / Outlook / anything else that isn't Google — download-and-open, no account or API needed. */
export function downloadIcs(event: CalendarEventInput) {
  const blob = new Blob([buildIcsFile(event)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`
  a.click()
  URL.revokeObjectURL(url)
}
