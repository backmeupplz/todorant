import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { lazy } from 'preact/compat'
import { call } from '../data/rest'
import { session, setSetting } from '../data/store'
import { t } from '../i18n'
import { Spinner, alert, confirm, showError, toast } from '../ui/kit'
import { go, query } from '../ui/router'
import { link } from './Landing'
import { Privacy, Terms } from './static'
import './pages.css'

const PublicReport = lazy(() => import('./Report').then((m) => m.PublicReport))

/** Everything that isn't the landing or the app: static pages, invite/report links, login and OAuth callbacks */
export function Pages({ path }: { path: string }) {
  const [, section, arg] = path.split('/')
  let body
  if (path === '/privacy') body = <Privacy />
  else if (path === '/terms') body = <Terms />
  else if (section === 'invite' && arg) body = <Task key={path} run={() => acceptInvite(arg)} />
  else if (section === 'report' && arg) body = <PublicReport uuid={arg} />
  else if (path === '/mobile-login/telegram') body = <TelegramMobile />
  else if (path === '/mobile_login_success') body = <p class="page-center emoji">✅</p>
  else if (path === '/mobile_login_error') body = <p class="page-center emoji">❌</p>
  else if (path === '/google_calendar_setup_web') body = <Task key={path} run={() => calendar(query.value.get('code'))} />
  else if (path === '/apple_firefox_error') body = <p class="page-center" dangerouslySetInnerHTML={{ __html: t('errors.appleFirefox') }} />
  else body = (
    <div class="page-center">
      <h1>{t('notFound')}</h1>
      <p><a {...link('/')}>Go to the main page</a></p>
    </div>
  )
  return (
    <>
      <header class="navbar">
        <div class="container">
          <a {...link('/')} title="Todorant"><img class="logo page-logo" src="/img/logo-small.svg" alt="Todorant" width={118} height={24} /></a>
        </div>
      </header>
      <main class="container page">{body}</main>
    </>
  )
}

/** Runs a one-off async job on mount behind a spinner */
function Task({ run }: { run: () => unknown }) {
  useEffect(() => void run(), [])
  return <div class="page-center"><Spinner /></div>
}

async function acceptInvite(token: string) {
  if (!session.value) {
    // Superpower accepts it after sign in
    try {
      sessionStorage.setItem('invite', token)
    } catch {}
    return go('/', true)
  }
  if (await confirm(t('delegate.inviteConfirm'), 'OK')) {
    try {
      await call('POST', '/v2/delegation/accept', { token })
      toast(t('delegate.inviteSuccess'))
    } catch {
      toast(t('errors.delegate.invalidToken'), true)
    }
  }
  go('/superpower', true)
}

async function calendar(code: string | null) {
  if (!session.value || !code) return go('/', true)
  try {
    setSetting('googleCalendarCredentials', await call('POST', '/google/calendarAuthorize', { code, web: true }))
    toast(t('googleCalendarEnableSuccess'))
  } catch (e) {
    showError(e)
  }
  go('/superpower', true)
}

/** The mobile apps open this page to log in via @todorant_bot: send a request, poll until it's allowed, hand the user back via the URL */
function TelegramMobile() {
  const id = useSignal('')
  const loading = useSignal(false)
  const request = useSignal('')
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!request.value) return
      const r = await call<{ allowed?: boolean; user?: object }>('POST', '/login/telegram_mobile_check', { uuid: request.value }, '').catch(() => null)
      if (r?.allowed === false) {
        request.value = ''
        alert(t('loginMobile.telegram.notAllowedError'))
      } else if (r?.allowed) {
        clearInterval(timer)
        location.href = `/mobile_login_success?data=${JSON.stringify(r.user)}`
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [])
  async function login(e: Event) {
    e.preventDefault()
    const telegramId = id.value.trim()
    if (!telegramId) return alert(t('loginMobile.telegram.noCredentialsError'))
    const uuid = crypto.randomUUID()
    loading.value = true
    try {
      await call('POST', '/login/telegram_mobile', { uuid, id: telegramId }, '')
      request.value = uuid
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      alert(message === 'Cannot send message' ? t('loginMobile.telegram.cannotSendMessageError') : message)
    } finally {
      loading.value = false
    }
  }
  return (
    <form class="page-center telegram-mobile" onSubmit={login}>
      <p dangerouslySetInnerHTML={{ __html: t('loginMobile.telegram.headline') }} />
      <label class="field">
        <span>{t('loginMobile.telegram.idHint')}</span>
        <input autofocus inputMode="numeric" placeholder={t('loginMobile.telegram.id')} value={id.value} onInput={(e) => (id.value = e.currentTarget.value)} />
      </label>
      <button type="submit" class="btn btn-primary" disabled={loading.value || !!request.value}>
        {loading.value || request.value ? <Spinner /> : t('loginMobile.telegram.loginButton')}
      </button>
      {request.value && <p dangerouslySetInnerHTML={{ __html: t('loginMobile.telegram.waiting') }} />}
    </form>
  )
}
