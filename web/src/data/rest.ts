import { session, type Profile } from './store'
import { API } from './sync'
import { campaign } from './campaign'

export class HttpError extends Error {}

/** JSON request to the backend with the session token */
export async function call<T = any>(method: string, path: string, body?: unknown, token = session.value?.token): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  if (!res.ok) throw new HttpError(json?.message || (typeof json === 'string' && json) || `Request failed (${res.status})`)
  return json
}

/** Logs in with a provider (google-firebase, facebook, apple-firebase, telegram, token) */
export async function login(provider: string, body: unknown): Promise<Profile> {
  // A promo link's campaign goes with every way of creating an account; the server counts it only for new ones
  const tag = provider === 'token' || provider === 'password' ? undefined : campaign()
  const user = await call('POST', `/v2/auth/${provider}`, tag ? { ...(body as object), campaign: tag } : body, '')
  // Only the profile is kept in this browser: settings arrive via sync
  const { token, name, email, facebookId, telegramId, appleSubId, passwordLogin, delegateInviteToken } = user
  return { id: user._id ?? user.id, token, name, email, facebookId, telegramId, appleSubId, passwordLogin, delegateInviteToken }
}
