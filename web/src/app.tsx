import { lazy, Suspense } from 'preact/compat'
import { session } from './data/store'
import { go, path } from './ui/router'
import { Dialogs, Snackbar, Spinner } from './ui/kit'
import { Landing } from './views/Landing'

const Superpower = lazy(() => import('./views/Superpower').then((m) => m.Superpower))
const Pages = lazy(() => import('./views/pages').then((m) => m.Pages))

/** OAuth providers return to these with the token in the hash */
const LANDING = ['/', '/facebook_login_result', '/google_login_result', '/apple_login_result']

export function App() {
  const p = path.value
  const signedIn = !!session.value
  if (signedIn && LANDING.includes(p)) queueMicrotask(() => go('/superpower', true))
  if (!signedIn && p === '/superpower') queueMicrotask(() => go('/', true))
  const page = LANDING.includes(p) || p === '/superpower' ? (signedIn ? <Superpower /> : <Landing />) : <Pages path={p} />
  return (
    <>
      <Suspense fallback={<div class="placeholder"><Spinner /></div>}>{page}</Suspense>
      <Dialogs />
      <Snackbar />
    </>
  )
}
