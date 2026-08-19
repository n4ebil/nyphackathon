import { useState } from 'react'
import { Icon } from './Icon.jsx'
import { downloadIcs, googleCalendarUrl } from '../shared/calendar.ts'

/** Small popover with both calendar options — Google (link, no download) and .ics (Apple/Outlook/everything else). */
export function AddToCalendar({ event, className = '' }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={'add-to-calendar' + (className ? ` ${className}` : '')}>
      <button type="button" className="outline" onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" size={13} /> Add to Calendar
      </button>
      {open && (
        <div className="add-to-calendar-menu">
          <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            Google Calendar
          </a>
          <button type="button" onClick={() => { downloadIcs(event); setOpen(false) }}>
            Apple / Outlook (.ics)
          </button>
        </div>
      )}
    </div>
  )
}
