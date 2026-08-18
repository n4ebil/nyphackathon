/**
 * Thin client for the AWS API Gateway + Lambda + DynamoDB backend deployed
 * by aws-integration/deploy.sh. This is the one file that knows the AWS API
 * shape; firestore.js and match.js just call these functions instead of
 * talking to Firestore for the match-request/matching pieces.
 *
 * VITE_API_BASE_URL is the ApiEndpoint printed at the end of deploy.sh, e.g.
 * https://abc123xyz.execute-api.us-east-1.amazonaws.com
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL

export const isAwsConfigured = Boolean(BASE_URL)

async function request(path, options = {}) {
  if (!isAwsConfigured) {
    throw new Error('AWS API is not configured — set VITE_API_BASE_URL in .env.local')
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`AWS API ${options.method || 'GET'} ${path} failed (${res.status}): ${body}`)
  }
  return res.status === 204 ? null : res.json()
}

/** Runs the deterministic matching engine server-side (AWS Lambda) instead of in the browser. */
export function computeMatchesRemote(input) {
  return request('/compute-matches', { method: 'POST', body: JSON.stringify(input) })
}

export function sendMatchRequestRemote(matchRequest) {
  return request('/match-requests', { method: 'POST', body: JSON.stringify(matchRequest) })
}

export function listMatchRequestsRemote(userId) {
  return request(`/match-requests?userId=${encodeURIComponent(userId)}`)
}

export function listAllMatchRequestsRemote() {
  return request('/match-requests')
}

export function respondToMatchRequestRemote(matchId, status) {
  return request(`/match-requests/${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}
