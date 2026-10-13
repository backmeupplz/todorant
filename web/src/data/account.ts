import { encryptionKey, load, pending, reset, session, type Profile } from './store'
import { login } from './rest'
import * as sync from './sync'
import { go } from '../ui/router'
import { closeDialogs, showError } from '../ui/kit'

/** Signs in (switching accounts clears this browser's data) and starts syncing */
export async function signIn(provider: string, body: unknown) {
  try {
    const profile = await login(provider, body)
    await start(profile)
  } catch (e) {
    showError(e)
  }
}

export async function start(profile: Profile) {
  if (session.value?.id !== profile.id) {
    sync.disconnect()
    await reset()
  }
  session.value = profile
  localStorage.removeItem('signedOut')
  closeDialogs()
  sync.start()
  go('/current', true)
}

export async function logout() {
  // Edits not pushed yet would be lost with the local data; give them a few seconds to reach the server
  if (pending().length) await Promise.race([sync.sync(), new Promise((r) => setTimeout(r, 5000))])
  // The old site's shared login cookie would sign us right back in
  for (const domain of ['', '; domain=todorant.com', '; domain=.todorant.com']) document.cookie = `token=; Max-Age=0; path=/${domain}`
  localStorage.setItem('signedOut', '1')
  sync.disconnect()
  session.value = null
  encryptionKey.value = null
  await reset()
  go('/', true)
  location.reload()
}

/** The old todorant.com keeps its token in a cookie for the whole domain; reuse it to sign in seamlessly */
export async function boot() {
  await load()
  if (session.value) return sync.start()
  const token = document.cookie.match(/(?:^|; )token=([^;]+)/)?.[1]
  if (token && !localStorage.getItem('signedOut')) {
    await login('token', { token: decodeURIComponent(token) }).then(start, () => {})
    // Used once: a cookie any todorant.com subdomain can set shouldn't keep signing this site in
    for (const domain of ['', '; domain=todorant.com', '; domain=.todorant.com']) document.cookie = `token=; Max-Age=0; path=/${domain}`
  }
}
