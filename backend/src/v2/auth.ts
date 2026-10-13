import { URL } from 'url'
import { IncomingMessage } from 'http'
import { getUserFromToken } from '@/middlewares/authenticate'

/** `Authorization: Bearer <token>`, the v1 `token` header, or `?token=` (WebSocket clients) */
export function tokenOf(headers: IncomingMessage['headers'], url?: string) {
  const auth = headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  if (typeof headers.token === 'string') return headers.token
  return url ? new URL(url, 'http://x').searchParams.get('token') || undefined : undefined
}

/** User id for a token, or undefined */
export async function authenticate(token?: string): Promise<string | undefined> {
  if (!token) return undefined
  try {
    const user = await getUserFromToken(token)
    return user ? String(user._id) : undefined
  } catch {
    return undefined
  }
}
