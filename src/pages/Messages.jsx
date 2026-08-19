import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { ContactFallback } from '../components/ContactFallback.jsx'
import { Icon } from '../components/Icon.jsx'
import { AppLoader } from '../components/AppLoader.jsx'
import { Banner, Spinner } from '../components/Spinner.jsx'
import {
  arrangeSession,
  editSession,
  getSessionsByMatchIds,
  listAllMessagesFor,
  listMatchRequests,
  listMessagesBetween,
  listUsers,
  respondToProposal,
  sendMessage,
  submitReport,
} from '../lib/firestore.js'
import { occurrenceThisWeek } from '../shared/calendar.ts'

const POLL_MS = 4000
const TICK_MS = 15_000
const GRACE_MS = 5 * 60 * 1000
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const THANKS_TEMPLATES = [
  'Thank you so much, that was really helpful!',
  "That was great, I'll leave you a review 🙌",
  'Appreciate your time — see you around!',
]
const REPORT_REASONS = [
  ['spam', 'Spam or advertising'],
  ['harassment', 'Harassment or abuse'],
  ['inappropriate', 'Inappropriate content'],
  ['scam', 'Scam or impersonation'],
  ['other', 'Other'],
]
const DAYS = DAY_ORDER

function proposalSummary(p) {
  return `Proposed ${p.day} ${p.startTime}–${p.endTime} · ${p.format === 'online' ? 'Online' : p.location}`
}

function formatTime(iso) {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })
}

/** Earliest-by-weekday arranged session across every match with this person — the one worth surfacing as "next up". */
function nextSessionOf(matches) {
  const arranged = matches.filter((m) => m.session?.status === 'arranged')
  if (!arranged.length) return null
  return [...arranged].sort((a, b) => DAY_ORDER.indexOf(a.session.day) - DAY_ORDER.indexOf(b.session.day))[0]
}

function templatesFor(nextMatch, otherName) {
  if (nextMatch) {
    const { session } = nextMatch
    const when = `${session.day} ${session.startTime}–${session.endTime}`
    return [
      `Confirming we're still on for ${when}?`,
      "Running a few minutes late, sorry!",
      'Could we reschedule this one?',
      'See you then!',
    ]
  }
  return [
    `Hi ${otherName}! When are you free to meet?`,
    'Could we set up a time this week?',
    'Looking forward to it!',
  ]
}

export function Messages() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [result, users, myMessages] = await Promise.all([
        listMatchRequests(user.userId),
        listUsers(),
        listAllMessagesFor(user.userId),
      ])
      const byId = Object.fromEntries(users.map((u) => [u.userId, u]))

      const combined = [
        ...result.incoming.map((r) => ({ r, otherId: r.studentId })),
        ...result.outgoing.map((r) => ({ r, otherId: r.tutorId })),
      ].filter(({ otherId }) => byId[otherId])

      const matchIds = combined.map(({ r }) => r.matchId)
      const sessions = matchIds.length ? await getSessionsByMatchIds(matchIds) : []
      const sessionByMatch = Object.fromEntries(sessions.map((s) => [s.matchId, s]))

      // Group every match by the other person, not by matchId — two people can
      // share several matches (different modules, or swapped tutor/student roles).
      const byOther = new Map()
      for (const { r, otherId } of combined) {
        if (!byOther.has(otherId)) byOther.set(otherId, { other: byId[otherId], matches: [] })
        byOther.get(otherId).matches.push({ matchId: r.matchId, moduleName: r.moduleName, createdAt: r.createdAt, session: sessionByMatch[r.matchId] || null })
      }

      const lastMessageByOther = new Map()
      for (const m of myMessages) {
        const otherId = m.fromUserId === user.userId ? m.toUserId : m.fromUserId
        const prev = lastMessageByOther.get(otherId)
        if (!prev || m.createdAt > prev.createdAt) lastMessageByOther.set(otherId, m)
      }

      const convos = [...byOther.entries()]
        .map(([otherId, { other, matches }]) => {
          const lastMessage = lastMessageByOther.get(otherId) || null
          const latestMatchAt = matches.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '')
          return { otherId, other, matches, lastMessage, sortKey: lastMessage?.createdAt || latestMatchAt }
        })
        .sort((a, b) => b.sortKey.localeCompare(a.sortKey))

      setConversations(convos)
      setActiveId((prev) => (prev && convos.some((c) => c.otherId === prev) ? prev : convos[0]?.otherId || null))
    } catch (err) {
      setError(err.message || 'Could not load your conversations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.userId])

  const q = search.trim().toLowerCase()
  const filteredConvos = q
    ? conversations.filter((c) => (c.other.name || c.other.email || '').toLowerCase().includes(q) || c.matches.some((m) => m.moduleName.toLowerCase().includes(q)))
    : conversations

  const active = conversations.find((c) => c.otherId === activeId) || null

  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">MESSAGES</p>
          <h1>Messages</h1>
          <p className="sub">One conversation per person, across every module you're matched on together.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading ? (
        <AppLoader compact />
      ) : conversations.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">💬</span>
          <p>
            No conversations yet — once you send or accept a tutoring request, you'll be able to message that person here.
          </p>
        </div>
      ) : (
        <div className="msg-layout">
          <div className="msg-sidebar">
            {conversations.length > 6 && (
              <div className="search-input msg-search">
                <Icon name="search" size={14} />
                <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            )}
            <div className="msg-convo-list">
              {filteredConvos.map((c) => {
                const next = nextSessionOf(c.matches)
                return (
                  <button
                    key={c.otherId}
                    className={'msg-convo-row' + (c.otherId === activeId ? ' active' : '')}
                    onClick={() => setActiveId(c.otherId)}
                  >
                    <Avatar name={c.other.name || c.other.email} id={c.other.userId} small />
                    <div className="msg-convo-info">
                      <b>{c.other.name || c.other.email}</b>
                      <span>{c.lastMessage ? c.lastMessage.text : next ? `Next: ${next.session.day} ${next.session.startTime}` : `About ${c.matches[0].moduleName}`}</span>
                    </div>
                    {c.lastMessage && <small className="msg-convo-time">{formatTime(c.lastMessage.createdAt)}</small>}
                  </button>
                )
              })}
              {filteredConvos.length === 0 && <p className="recommend-copy msg-no-match">No conversations match "{search}".</p>}
            </div>
          </div>

          {active ? (
            <Thread key={active.otherId} otherId={active.otherId} other={active.other} matches={active.matches} myId={user.userId} myName={user.name || user.email} onSessionChanged={load} />
          ) : (
            <div className="msg-thread msg-thread-empty">
              <p className="recommend-copy">Select a conversation to view it.</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function Thread({ otherId, other, matches, myId, myName, onSessionChanged }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [proposing, setProposing] = useState(false)
  const [respondingId, setRespondingId] = useState(null)
  const [reporting, setReporting] = useState(false)
  const [reportSent, setReportSent] = useState(false)
  const bottomRef = useRef(null)

  const matchesById = useMemo(() => Object.fromEntries(matches.map((m) => [m.matchId, m])), [matches])
  const next = useMemo(() => nextSessionOf(matches), [matches])
  // New messages attach to whichever match is "live" right now — the upcoming session if
  // there is one, otherwise the most recently created match between these two people.
  const defaultMatchId = useMemo(() => next?.matchId || [...matches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.matchId, [next, matches])

  // Ticks every 15s so the "session ended, N minutes left to chat" state updates live
  // without needing a full data reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // The session that governs whether this thread is winding down — only relevant when
  // there's nothing upcoming with this person; an upcoming session always keeps the
  // thread fully open, regardless of what other matches have already wrapped up.
  const endedAt = useMemo(() => {
    if (next) return null
    const session = matchesById[defaultMatchId]?.session
    if (!session) return null
    // zoomEndedAt is the real signal — Zoom's own webhook firing the moment the call actually
    // ended (see functions/index.js#onZoomWebhook) — so it wins over any time-based guess
    // whenever it's present, for both online and (once completed) in-person sessions.
    if (session.zoomEndedAt) return new Date(session.zoomEndedAt)
    if (session.status === 'completed') {
      return new Date(session.completedAt || occurrenceThisWeek(session.day, session.endTime))
    }
    if (session.status === 'arranged') {
      const end = occurrenceThisWeek(session.day, session.endTime)
      return end.getTime() <= Date.now() ? end : null
    }
    return null
  }, [next, matchesById, defaultMatchId])

  const msSinceEnd = endedAt ? now - endedAt.getTime() : null
  const isEnded = msSinceEnd != null && msSinceEnd >= 0
  const graceRemainingMs = isEnded ? GRACE_MS - msSinceEnd : null
  const chatClosed = isEnded && graceRemainingMs <= 0

  const templates = useMemo(
    () => (isEnded ? THANKS_TEMPLATES : templatesFor(next, other.name || other.email)),
    [isEnded, next, other],
  )

  async function load(silent) {
    if (!silent) setLoading(true)
    try {
      const msgs = await listMessagesBetween(myId, otherId)
      setMessages(msgs)
    } catch (err) {
      if (!silent) setError(err.message || 'Could not load this conversation.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
    const interval = setInterval(() => load(true), POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function onSend(e) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || !defaultMatchId || chatClosed) return
    setSending(true)
    setError('')
    try {
      await sendMessage({ matchId: defaultMatchId, fromUserId: myId, toUserId: otherId, text: trimmed })
      setText('')
      await load(true)
    } catch (err) {
      setError(err.message || 'Could not send that message.')
    } finally {
      setSending(false)
    }
  }

  async function onReport({ reason, details }) {
    setSending(true)
    setError('')
    try {
      // Last 10 messages, in order — evidence as the admin will actually see it, not just the one that
      // prompted the report, since context (who said what, in what order) usually matters more than one line.
      const evidence = messages.slice(-10).map((m) => `${m.fromUserId === myId ? 'Me' : (other.name || other.email)}: ${m.text}`).join('\n')
      await submitReport({
        reporterId: myId,
        reporterName: myName,
        reportedUserId: otherId,
        reportedName: other.name || other.email,
        matchId: defaultMatchId,
        reason,
        details,
        evidence: evidence || '(no messages in this conversation yet)',
      })
      setReporting(false)
      setReportSent(true)
    } catch (err) {
      setError(err.message || 'Could not submit that report.')
    } finally {
      setSending(false)
    }
  }

  async function onPropose(proposal) {
    if (!defaultMatchId || chatClosed) return
    setSending(true)
    setError('')
    try {
      await sendMessage({
        matchId: defaultMatchId,
        fromUserId: myId,
        toUserId: otherId,
        text: proposalSummary(proposal),
        type: 'proposal',
        proposal,
      })
      setProposing(false)
      await load(true)
    } catch (err) {
      setError(err.message || 'Could not send that proposal.')
    } finally {
      setSending(false)
    }
  }

  async function onRespond(message, accept) {
    setRespondingId(message.id)
    setError('')
    try {
      if (accept) {
        const match = matchesById[message.matchId]
        if (match?.session) await editSession(message.matchId, message.proposal)
        else await arrangeSession(message.matchId, message.proposal)
      }
      await respondToProposal(message.id, accept ? 'accepted' : 'declined')
      await load(true)
      onSessionChanged?.()
    } catch (err) {
      setError(err.message || 'Could not respond to that proposal.')
    } finally {
      setRespondingId(null)
    }
  }

  // Session divider to show right before the first message of a given match, whenever
  // the match changes as we walk through the merged, time-ordered message list.
  function dividerFor(match) {
    if (!match) return null
    const { session, moduleName } = match
    if (session?.status === 'completed') return `Session ended — ${moduleName} · ${session.day} ${session.startTime}–${session.endTime}`
    if (session?.status === 'cancelled') return `Session cancelled — ${moduleName} · ${session.day} ${session.startTime}–${session.endTime}`
    if (session?.status === 'arranged') return `Session arranged — ${moduleName} · ${session.day} ${session.startTime}–${session.endTime}`
    return `About ${moduleName}`
  }

  let lastMatchId = null

  return (
    <div className="msg-thread">
      <div className="msg-thread-head">
        <Avatar name={other.name || other.email} id={other.userId} small />
        <div>
          <b>{other.name || other.email}</b>
          <span>{matches.length > 1 ? `${matches.length} modules together` : matches[0]?.moduleName}</span>
        </div>
        <button type="button" className="msg-report-btn" onClick={() => setReporting(true)} title="Report this conversation">
          Report
        </button>
      </div>

      {reporting && (
        <ReportModal
          otherName={other.name || other.email}
          busy={sending}
          onCancel={() => setReporting(false)}
          onSubmit={onReport}
        />
      )}
      {reportSent && (
        <div className="msg-session-strip">
          <Icon name="check" size={13} /> <span>Report submitted — an admin will review it.</span>
        </div>
      )}

      {!loading && (
        <div className={'msg-session-strip' + (next ? ' arranged' : chatClosed ? ' closed' : isEnded ? ' ending' : '')}>
          <Icon name={chatClosed ? 'lock' : 'clock'} size={13} />
          {next ? (
            <span>
              Next session <b>{next.session.day} {next.session.startTime}–{next.session.endTime}</b> · {next.moduleName} ·{' '}
              {next.session.format === 'online' ? 'Online' : next.session.location}
              {next.session.format === 'online' && next.session.zoomLink && (
                <> · <a href={next.session.zoomLink} target="_blank" rel="noreferrer">Join Zoom</a></>
              )}
            </span>
          ) : chatClosed ? (
            <span>
              This chat closed 5 minutes after the session ended. <Link to="/sessions">Leave feedback</Link> or start a new match to keep talking.
            </span>
          ) : isEnded ? (
            <span>
              Session ended — you can still chat for <b>{Math.ceil(graceRemainingMs / 60000)} more minute{Math.ceil(graceRemainingMs / 60000) === 1 ? '' : 's'}</b>. <Link to="/sessions">Leave feedback</Link>?
            </span>
          ) : (
            <span>No upcoming session set yet</span>
          )}
        </div>
      )}

      {!loading && <ContactFallback user={other} className="msg-contact-fallback" />}

      {error && <Banner kind="error">{error}</Banner>}

      <div className="msg-bubbles">
        {loading ? (
          <Spinner />
        ) : messages.length === 0 ? (
          <p className="recommend-copy msg-no-match">No messages yet — say hi.</p>
        ) : (
          messages.map((m) => {
            const showDivider = m.matchId !== lastMatchId
            lastMatchId = m.matchId
            const divider = showDivider ? dividerFor(matchesById[m.matchId]) : null
            return (
              <div key={m.id}>
                {divider && (
                  <div className="msg-divider">
                    <span>{divider}</span>
                  </div>
                )}
                {m.type === 'proposal' ? (
                  <ProposalCard message={m} mine={m.fromUserId === myId} busy={respondingId === m.id} onRespond={onRespond} />
                ) : (
                  <div className={'msg-bubble' + (m.fromUserId === myId ? ' mine' : '')}>
                    <p>{m.text}</p>
                    <small>{formatTime(m.createdAt)}</small>
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {!chatClosed && (
        proposing ? (
          <ProposeForm
            initial={next?.session}
            busy={sending}
            onCancel={() => setProposing(false)}
            onSubmit={onPropose}
          />
        ) : (
          <div className="msg-templates">
            {!isEnded && (
              <button type="button" className="msg-propose-btn" onClick={() => setProposing(true)}>
                <Icon name="calendar" size={13} /> Propose a time
              </button>
            )}
            {templates.map((t) => (
              <button type="button" key={t} onClick={() => setText(t)}>{t}</button>
            ))}
          </div>
        )
      )}

      <form className="msg-input-row" onSubmit={onSend}>
        <input
          placeholder={chatClosed ? 'This chat has closed' : 'Write a message…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending || chatClosed}
        />
        <button type="submit" disabled={sending || chatClosed || !text.trim()}>
          {sending ? <Spinner /> : <Icon name="arrow" size={16} />}
        </button>
      </form>
    </div>
  )
}

function ProposalCard({ message, mine, busy, onRespond }) {
  const { proposal, status } = message
  return (
    <div className={'proposal-card' + (mine ? ' mine' : '')}>
      <div className="proposal-head">
        <Icon name="calendar" size={14} />
        <b>{mine ? 'You proposed' : 'Proposed'}</b>
      </div>
      <p>
        {proposal.day} {proposal.startTime}–{proposal.endTime} · {proposal.format === 'online' ? 'Online' : proposal.location}
      </p>
      {status === 'pending' && !mine && (
        <div className="proposal-actions">
          <button className="outline" disabled={busy} onClick={() => onRespond(message, false)}>Decline</button>
          <button disabled={busy} onClick={() => onRespond(message, true)}>{busy ? <Spinner /> : 'Accept'}</button>
        </div>
      )}
      {status === 'pending' && mine && <span className="proposal-status">Waiting for a response</span>}
      {status === 'accepted' && <span className="proposal-status accepted"><Icon name="check" size={12} /> Accepted</span>}
      {status === 'declined' && <span className="proposal-status declined"><Icon name="x" size={12} /> Declined</span>}
      <small>{formatTime(message.createdAt)}</small>
    </div>
  )
}

function ProposeForm({ initial, busy, onCancel, onSubmit }) {
  const [day, setDay] = useState(initial?.day || 'Mon')
  const [startTime, setStartTime] = useState(initial?.startTime || '14:00')
  const [endTime, setEndTime] = useState(initial?.endTime || '15:00')
  const [format, setFormat] = useState(initial?.format || 'in-person')
  const [location, setLocation] = useState(initial?.format === 'online' ? '' : initial?.location || '')

  return (
    <div className="arrange-form msg-propose-form">
      <div className="arrange-grid">
        <label className="field">
          Day
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="field">
          Start
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="field">
          End
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
        <label className="field">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="in-person">In-person</option>
            <option value="online">Online</option>
          </select>
        </label>
        <label className="field arrange-location">
          {format === 'online' ? 'Notes (optional)' : 'Location'}
          <input
            placeholder={format === 'online' ? 'A Zoom link is shared once accepted' : 'e.g. Campus library'}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
      </div>
      <div className="arrange-actions">
        <button className="outline" disabled={busy} onClick={onCancel}>Cancel</button>
        <button
          disabled={busy || endTime <= startTime}
          onClick={() => onSubmit({ day, startTime, endTime, format, location: location || (format === 'online' ? 'Online' : 'Campus library') })}
        >
          {busy ? <Spinner /> : 'Send proposal'}
        </button>
      </div>
    </div>
  )
}

function ReportModal({ otherName, busy, onCancel, onSubmit }) {
  const [reason, setReason] = useState(REPORT_REASONS[0][0])
  const [details, setDetails] = useState('')

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel report-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onCancel}><Icon name="x" size={16} /></button>
        <p className="eyebrow">REPORT</p>
        <h2>Report {otherName}</h2>
        <p className="recommend-copy">
          The last 10 messages in this conversation are attached automatically as evidence. An admin will review
          this and can act on it — including locking the account — right away.
        </p>
        <label className="field">
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REPORT_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          What happened? <span className="field-optional">(optional)</span>
          <textarea placeholder="Any extra context that would help an admin review this…" value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <div className="arrange-actions">
          <button className="outline" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="card-btn inline danger-btn" disabled={busy} onClick={() => onSubmit({ reason, details })}>
            {busy ? <Spinner /> : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  )
}
