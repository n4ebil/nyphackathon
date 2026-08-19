import { useState } from 'react'
import { Icon } from './Icon.jsx'

/**
 * Deliberately not shown everywhere — only where a real relationship already
 * exists (an accepted match, an arranged/completed session). Browsing tutors
 * or a still-pending request never reveals this; trust there is built with
 * aggregate signals (rating, response rate), not contact details, since
 * nothing has actually been agreed to yet. Collapsed by default so it reads
 * as a deliberate fallback ("messaging isn't working") rather than the
 * primary way to reach someone.
 */
export function ContactFallback({ user, className = '' }) {
  const [open, setOpen] = useState(false)
  if (!user?.email && !user?.phone) return null

  return (
    <div className={'contact-fallback' + (className ? ` ${className}` : '')}>
      <button type="button" onClick={() => setOpen((o) => !o)}>
        <Icon name="message" size={12} /> {open ? 'Hide backup contact' : "Messaging not working? Show backup contact"}
      </button>
      {open && (
        <div className="contact-fallback-details">
          {user.email && <span><Icon name="inbox" size={11} /> {user.email}</span>}
          {user.phone && <span><Icon name="user" size={11} /> {user.phone}</span>}
        </div>
      )}
    </div>
  )
}
