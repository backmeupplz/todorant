import { session } from './data/store'
import { appRoute, go, path } from './ui/router'
import { Dialogs, lazy, Snackbar } from './ui/kit'
import { PageSkeleton, TAB_SKELETONS } from './ui/skeletons'
import { Landing } from './views/Landing'

const Superpower = lazy(() => import('./views/Superpower').then((m) => m.Superpower), () => TAB_SKELETONS[appRoute()?.tab ?? 'current']())
const Pages = lazy(() => import('./views/pages').then((m) => m.Pages), PageSkeleton)

/** OAuth providers return to these with the token in the hash */
const LANDING = ['/', '/facebook_login_result', '/google_login_result', '/apple_login_result']

export function App() {
  const p = path.value
  const signedIn = !!session.value
  const inApp = !!appRoute(p)
  if (signedIn && LANDING.includes(p)) queueMicrotask(() => go('/current', true))
  if (!signedIn && inApp) queueMicrotask(() => go('/', true))
  const page = LANDING.includes(p) || inApp ? (signedIn ? <Superpower /> : <Landing />) : <Pages path={p} />
  return (
    <>
      {page}
      <Dialogs />
      <Snackbar />
    </>
  )
}
