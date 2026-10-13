import { encryptionKey, load, reset, session, type Profile } from './store'
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
  closeDialogs()
  sync.start()
  go('/superpower', true)
}

export async function logout() {
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
  if (token) await login('token', { token: decodeURIComponent(token) }).then(start, () => {})
}
