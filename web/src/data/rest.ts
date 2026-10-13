import { session, type Profile } from './store'
import { API } from './sync'

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
  const user = await call('POST', `/v2/auth/${provider}`, body, '')
  return { ...user, id: user._id ?? user.id }
}
