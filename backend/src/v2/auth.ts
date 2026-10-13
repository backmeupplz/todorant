import { IncomingMessage } from 'http'
import { URL } from 'url'
import { getUserFromToken } from '@/middlewares/authenticate'

/** `Authorization: Bearer <token>` or the v1 `token` header */
export function tokenOf(headers: IncomingMessage['headers']) {
  const auth = headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  if (typeof headers.token === 'string') return headers.token
}

/** Browsers can't set WebSocket headers: they offer `new WebSocket(url, ['todorant', token])` */
export const PROTOCOL = 'todorant'

/**
 * WebSocket handshakes: the token as a subprotocol next to `todorant`, a header, or `?token=` — only
 * for the Android app released before the others existed, as URLs end up in proxy logs.
 */
export function socketTokenOf(request: IncomingMessage) {
  const offered = String(request.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((p) => p.trim())
  if (offered.includes(PROTOCOL))
    return offered.find((p) => p && p !== PROTOCOL)
  return (
    tokenOf(request.headers) ||
    new URL(request.url || '', 'http://x').searchParams.get('token') ||
    undefined
  )
}

/** User id for a token, or undefined */
export async function authenticate(
  token?: string
): Promise<string | undefined> {
  if (!token) return undefined
  try {
    const user = await getUserFromToken(token)
    return user ? String(user._id) : undefined
  } catch {
    return undefined
  }
}

// Every user's REST requests and socket messages draw from one budget: bursts of BURST, refilled
// at RATE per second. Big pushes and pulls cost more (see sync), so floods block nobody else.
const BURST = 120
const RATE = 10
const budgets = new Map<string, { left: number; at: number }>()

/** Charges [cost] to the user's budget; false when it was already spent */
export function spend(userId: string, cost: number) {
  const now = Date.now()
  const budget = budgets.get(userId) || { left: BURST, at: now }
  const left = Math.min(BURST, budget.left + ((now - budget.at) / 1000) * RATE)
  // Debt is capped: a client that stops flooding is back within BURST * 2 / RATE seconds
  budgets.set(userId, { left: Math.max(-BURST, left - cost), at: now })
  return left >= cost
}

// A full budget is the default: forget those
setInterval(() => {
  const now = Date.now()
  for (const [userId, { left, at }] of budgets)
    if (left + ((now - at) / 1000) * RATE >= BURST) budgets.delete(userId)
}, 60000).unref()
