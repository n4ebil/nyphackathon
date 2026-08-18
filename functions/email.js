const nodemailer = require('nodemailer')
const { defineSecret } = require('firebase-functions/params')

const GMAIL_USER = defineSecret('GMAIL_USER')
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD')

const BRAND = { name: 'NYPkaki', orange: '#EC7211', navy: '#232F3E', ink: '#1c1a2e', muted: '#6a6684', bg: '#faf8f4' }
const APP_URL = 'https://nypkaki.vercel.app'

let cachedTransporter = null

/** Lazily builds the SMTP transport — the secrets aren't readable until a function actually runs with them declared. */
function getTransporter() {
  if (cachedTransporter) return cachedTransporter
  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
  })
  return cachedTransporter
}

/**
 * Table-based layout on purpose — the golden rule for HTML email, since many
 * clients (Outlook especially) ignore modern CSS like flexbox/grid entirely.
 */
function wrap(bodyHtml, { title, actionLabel, actionUrl }) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:480px;width:100%;">
        <tr><td style="background:${BRAND.navy};padding:20px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:30px;height:30px;background:${BRAND.orange};border-radius:9px;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:16px;">N</td>
            <td style="padding-left:10px;color:#ffffff;font-weight:800;font-size:17px;">NYP<span style="color:${BRAND.orange};">kaki</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <h1 style="margin:0 0 16px;font-size:19px;color:${BRAND.ink};">${title}</h1>
          <div style="font-size:14px;line-height:1.6;color:${BRAND.ink};">${bodyHtml}</div>
        </td></tr>
        ${actionUrl ? `<tr><td style="padding:8px 28px 30px;">
          <a href="${actionUrl}" style="display:inline-block;background:${BRAND.orange};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px;">${actionLabel}</a>
        </td></tr>` : '<tr><td style="padding-bottom:20px;"></td></tr>'}
        <tr><td style="padding:16px 28px;border-top:1px solid #f0e6d8;">
          <p style="margin:0;font-size:11px;color:${BRAND.muted};">NYPkaki — peer tutoring, matched by real fit.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

async function send({ to, subject, html }) {
  if (!to) return
  const transporter = getTransporter()
  await transporter.sendMail({
    from: `"NYPkaki" <${GMAIL_USER.value()}>`,
    to,
    subject,
    html,
  })
}

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }

/** "Wed", "14:00", "15:00" -> "Wednesday, 2:00 PM – 3:00 PM" — for the weekly-recurring day model 1:1 sessions use. */
function formatWeekday(day, startTime, endTime) {
  return `${DAY_FULL[day] || day}, ${fmtTime(startTime)} – ${fmtTime(endTime)}`
}

/** "2026-08-21", "14:00", "15:00" -> "Friday, 21 August, 2:00 PM – 3:00 PM" — for the fixed-calendar-date model scheduled classes use. */
function formatDate(iso, startTime, endTime) {
  const date = new Date(`${iso}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })
  return `${date}, ${fmtTime(startTime)} – ${fmtTime(endTime)}`
}

// ---------------------------------------------------------------- templates

async function sendRequestReceived({ tutorEmail, tutorName, studentName, moduleName, message }) {
  const html = wrap(
    `<p>Hi ${tutorName || 'there'},</p>
     <p><b>${studentName}</b> just requested tutoring from you for <b>${moduleName}</b>.</p>
     ${message ? `<p style="background:#fbf3ea;border-radius:10px;padding:12px 14px;font-style:italic;">"${message}"</p>` : ''}
     <p>Accept or decline it from your Requests page.</p>`,
    { title: 'New tutoring request', actionLabel: 'View request', actionUrl: `${APP_URL}/requests` },
  )
  await send({ to: tutorEmail, subject: `${studentName} requested tutoring for ${moduleName}`, html })
}

async function sendRequestSentConfirmation({ studentEmail, studentName, tutorName, moduleName }) {
  const html = wrap(
    `<p>Hi ${studentName || 'there'},</p>
     <p>Your tutoring request for <b>${moduleName}</b> was sent to <b>${tutorName}</b>. We'll email you the moment they respond.</p>`,
    { title: 'Request sent', actionLabel: 'View your requests', actionUrl: `${APP_URL}/requests` },
  )
  await send({ to: studentEmail, subject: `Your request for ${moduleName} was sent to ${tutorName}`, html })
}

async function sendSessionConfirmed({ toEmail, toName, otherName, moduleName, when, format, location, zoomLink }) {
  const html = wrap(
    `<p>Hi ${toName || 'there'},</p>
     <p>Your <b>${moduleName}</b> session with <b>${otherName}</b> is confirmed.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fbf3ea;border-radius:12px;margin:16px 0;">
       <tr><td style="padding:14px 16px;font-size:13px;">
         <b>${when}</b><br/>
         ${format === 'online' ? 'Online' : 'In-person'} · ${location}
         ${zoomLink ? `<br/><br/><a href="${zoomLink}" style="color:${BRAND.orange};font-weight:700;">${zoomLink}</a>` : ''}
       </td></tr>
     </table>`,
    { title: 'Session confirmed', actionLabel: 'View session', actionUrl: `${APP_URL}/sessions` },
  )
  await send({ to: toEmail, subject: `Confirmed: ${moduleName} with ${otherName}, ${when}`, html })
}

async function sendSessionReminder({ toEmail, toName, otherName, moduleName, when, format, location, zoomLink, hoursAway }) {
  const html = wrap(
    `<p>Hi ${toName || 'there'},</p>
     <p>Reminder: your <b>${moduleName}</b> session with <b>${otherName}</b> is coming up ${hoursAway <= 1 ? 'very soon' : `in about ${hoursAway} hours`}.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fbf3ea;border-radius:12px;margin:16px 0;">
       <tr><td style="padding:14px 16px;font-size:13px;">
         <b>${when}</b><br/>
         ${format === 'online' ? 'Online' : 'In-person'} · ${location}
         ${zoomLink ? `<br/><br/><a href="${zoomLink}" style="color:${BRAND.orange};font-weight:700;">${zoomLink}</a>` : ''}
       </td></tr>
     </table>`,
    { title: 'Upcoming session reminder', actionLabel: 'View session', actionUrl: `${APP_URL}/sessions` },
  )
  await send({ to: toEmail, subject: `Reminder: ${moduleName} with ${otherName} — ${when}`, html })
}

async function sendClassRequestSubmitted({ toEmail, toName, moduleName }) {
  const html = wrap(
    `<p>Hi ${toName || 'there'},</p>
     <p>Your request for help with <b>${moduleName}</b> has been posted. Once enough classmates pile on, it's surfaced to tutors who teach it — we'll email you the moment it's confirmed.</p>`,
    { title: 'Request posted', actionLabel: 'View your request', actionUrl: `${APP_URL}/schedule` },
  )
  await send({ to: toEmail, subject: `Your request for ${moduleName} has been posted`, html })
}

async function sendClassConfirmed({ toEmail, toName, moduleName, teacherName, date, startTime, endTime, location }) {
  const html = wrap(
    `<p>Hi ${toName || 'there'},</p>
     <p>The <b>${moduleName}</b> class you're in is confirmed, hosted by <b>${teacherName}</b>.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fbf3ea;border-radius:12px;margin:16px 0;">
       <tr><td style="padding:14px 16px;font-size:13px;">
         <b>${new Date(`${date}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}</b><br/>
         ${fmtTime(startTime)} – ${fmtTime(endTime)} · ${location}
       </td></tr>
     </table>`,
    { title: 'Class confirmed', actionLabel: 'View schedule', actionUrl: `${APP_URL}/schedule` },
  )
  await send({ to: toEmail, subject: `Confirmed: ${moduleName} class with ${teacherName}`, html })
}

module.exports = {
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  sendRequestReceived,
  sendRequestSentConfirmation,
  sendClassRequestSubmitted,
  sendSessionConfirmed,
  sendSessionReminder,
  sendClassConfirmed,
  fmtTime,
  formatWeekday,
  formatDate,
}
