import { lazy, Suspense } from 'preact/compat'
import { loaded, session } from './data/store'
import { path } from './ui/router'
import { Dialogs, Snackbar, Spinner } from './ui/kit'
import { Landing } from './views/Landing'

const Superpower = lazy(() => import('./views/Superpower').then((m) => m.Superpower))
const Pages = lazy(() => import('./views/pages').then((m) => m.Pages))

const LANDING = ['/', '/facebook_login_result', '/google_login_result', '/apple_login_result']

export function App() {
  const p = path.value
  let page
  if (LANDING.includes(p) && !(session.value && loaded.value && p === '/')) page = <Landing />
  else if (p === '/superpower' || (p === '/' && session.value)) page = session.value ? <Superpower /> : <Landing />
  else page = <Pages path={p} />
  return (
    <>
      <Suspense fallback={<div class="placeholder"><Spinner /></div>}>{page}</Suspense>
      <Dialogs />
      <Snackbar />
    </>
  )
}
