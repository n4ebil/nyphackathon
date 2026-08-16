/** Single source of truth for who can reach the admin page and its actions. */
export const ADMIN_EMAILS = ['demo@peerlink.app']

export function isAdminEmail(email) {
  return Boolean(email) && ADMIN_EMAILS.includes(email.toLowerCase())
}
