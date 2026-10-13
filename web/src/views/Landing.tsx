import { useSignal } from '../lib/state'
import { useEffect } from 'preact/hooks'
import { signIn } from '../data/account'
import { call } from '../data/rest'
import { API } from '../data/sync'
import { isDark, prefs, session, setPref } from '../data/store'
import { language, LANGUAGES, setLanguage, t, tRaw, type Language } from '../i18n'
import { qr } from '../lib/qr'
import { DialogCard, Button, Spinner, open, showError } from '../ui/kit'
import { go, path, query } from '../ui/router'
import './Landing.css'

const APP_STORE = 'https://apps.apple.com/app/todorant/id1482078243'
const PLAY = 'https://play.google.com/store/apps/details?id=com.todorant'
const SHOTS = ['en', 'es', 'it', 'ru', 'uk']

/** Props for an in-app link: a real href for new tabs, client-side navigation on a plain click */
export const link = (to: string) => ({
  href: to,
  onClick: (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    go(to)
  },
})

/** Logged out landing page; also finishes the OAuth redirects that come back to it */
export function Landing() {
  useEffect(finishRedirectLogin, [])
  const lang = SHOTS.includes(language.value) ? language.value : 'en'
  const contact: string[] = tRaw('home.texts.contact')
  return (
    <div class="landing">
      <header class="container landing-top">
        <a {...link('/')}><img class="landing-logo" src="/img/logo.svg" alt="Todorant" width={148} height={30} /></a>
      </header>
      <main class="container">
        <section class="hero">
          <div>
            <h1>
              {t('homeShort.headline')}
              <br />
              {t('homeShort.headline2')}
            </h1>
            <div class="hero-cta">
              <button type="button" class="hero-signin" onClick={openSignIn}>{t('home.signIn')}</button>
              <a href={APP_STORE} target="_blank" rel="noreferrer noopener" title="App Store"><img src="/img/appstore.svg" alt="App Store" /></a>
              <a href={PLAY} target="_blank" rel="noreferrer noopener" title="Google Play"><img src="/img/playstore.svg" alt="Google Play" /></a>
            </div>
          </div>
          <ul class="hero-features">
            {[1, 2, 3, 4].map((i) => <li key={i}>{t(`homeShort.feature${i}`)}</li>)}
          </ul>
        </section>
        <section class="difference">
          <div>
            <h2>{t('homeShort.differenceTitle')}</h2>
            {[1, 2, 3].map((i) => <p key={i}>{t(`homeShort.differenceText${i}`)}</p>)}
          </div>
          <div class="shot" aria-hidden="true">
            <i class="shot-blue" />
            <i class="shot-yellow" />
            <img src={`/img/screenshots/${lang}${isDark() ? '-dark' : ''}.webp`} alt="" width={300} height={649} />
          </div>
        </section>
      </main>
      <footer class="container landing-footer">
        <p>
          {contact[0]}
          <a href="mailto:n@borodutch.com">n@borodutch.com</a>
          {contact[1]}
        </p>
        <nav>
          <a {...link('/privacy')}>{t('home.privacy')}</a>
          <a {...link('/terms')}>Terms of use</a>
          <select aria-label="Language" title="Language" value={language.value} onChange={(e) => setLanguage(e.currentTarget.value as Language)}>
            {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <button type="button" class="landing-dark" aria-pressed={isDark()} onClick={() => setPref('colorMode', isDark() ? 'light' : 'dark')}>
            {t(`menu.darkMode.${isDark() ? 'on' : 'off'}`)}
          </button>
        </nav>
      </footer>
    </div>
  )
}

// region Sign in

function hashArg(name: string) {
  return new RegExp(`${name}=([^&]+)`).exec(decodeURIComponent(location.hash))?.[1]
}

// Each OAuth redirect carries a random state remembered by this tab; a return without it is someone else's
// login handed to us through a link (login CSRF) and is ignored
const STATE = 'oauth-state'
function newState() {
  const state = crypto.randomUUID()
  sessionStorage.setItem(STATE, state)
  return state
}

/** Google/Facebook come back with #access_token, Apple (via the backend) with #…id_token=…&user=… — all with our state */
function finishRedirectLogin() {
  const p = path.value
  const accessToken = hashArg('access_token')
  const idToken = hashArg('id_token')
  const done = () => go('/', true)
  const expected = sessionStorage.getItem(STATE)
  if (accessToken || idToken) {
    sessionStorage.removeItem(STATE)
    if (!expected || hashArg('state') !== expected) return done()
  }
  if (accessToken && p === '/google_login_result') done(), signIn('google-firebase', { accessToken })
  else if (accessToken && p === '/facebook_login_result') done(), signIn('facebook', { accessToken })
  else if (idToken) {
    const user = hashArg('user')
    let parsed
    try {
      parsed = user ? JSON.parse(user) : undefined
    } catch {}
    done(), signIn('apple-firebase', { credential: { oauthIdToken: idToken }, user: parsed })
  } else if (p !== '/') done()
}

const uuid = () => crypto.randomUUID()
const redirect = (url: string) => (location.href = url)
const PROVIDERS: { name: string; key: string; icon: string; go: () => void }[] = [
  {
    name: 'facebook', key: 'home.facebook', icon: '/img/facebook.svg',
    go: () => redirect(`https://www.facebook.com/dialog/oauth?client_id=640750769753434&redirect_uri=${location.origin}/facebook_login_result&scope=email,public_profile&response_type=token&auth_type=rerequest&state=${newState()}`),
  },
  {
    name: 'google', key: 'home.google', icon: '/img/google.svg',
    go: () => redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=989382323327-rou6lmk2umbnoaq55493v1kqm8fvp22q.apps.googleusercontent.com&redirect_uri=${location.origin}/google_login_result&response_type=token&scope=https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/userinfo.email&prompt=select_account&state=${newState()}`),
  },
  {
    name: 'apple', key: 'home.apple', icon: '/img/apple.svg',
    go: () => redirect(`https://appleid.apple.com/auth/authorize?response_type=code%20id_token&response_mode=form_post&client_id=com.todorant.web&redirect_uri=https://backend.todorant.com/login/apple_login_result&scope=email%20name&nonce=${uuid()}&state=${newState()}`),
  },
]

/** Self-hosted servers: the OAuth apps only know todorant.com, so email + password and the QR code are the ways in */
const customServer = () => API !== 'https://backend.todorant.com'

function openSignIn() {
  if (!customServer()) loadTelegram()
  open((close) => {
    const auth = (provider: string, body: unknown) => signIn(provider, body).then(() => session.value && close())
    const buttons = [
      ...(customServer() ? [] : [...PROVIDERS, { name: 'telegram', key: 'm.loginTelegram', icon: '/img/telegram.svg', go: () => telegramLogin((user) => auth('telegram', user)) }]),
      { name: 'qr', key: 'home.mobile', icon: '/img/qr-code.svg', go: () => open((closeQr) => <QrLogin close={closeQr} onToken={(token) => (closeQr(), auth('token', { token }))} />, true) },
    ]
    const email = <EmailSignIn auth={auth} />
    return (
      <div class="card signin">
        <h2 class="dialog-title">{t('home.signIn')}</h2>
        {customServer() && <>{email}<hr /></>}
        {buttons.map((p) => (
          <button key={p.name} type="button" class={`signin-btn signin-${p.name}`} onClick={p.go}>
            <img src={p.icon} alt="" width={20} height={20} />
            {t(p.key)}
          </button>
        ))}
        {!customServer() && <><hr />{email}</>}
      </div>
    )
  })
}

/** Email + password: sign in, or create an account (the server keeps these apart from OAuth accounts) */
function EmailSignIn({ auth }: { auth: (provider: string, body: unknown) => Promise<unknown> }) {
  const busy = useSignal(false)
  // The browser checks the fields (an email, 8+ characters) before either button submits
  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget as HTMLFormElement)
    busy.value = true
    await auth((e.submitter as HTMLButtonElement | null)?.value === 'signup' ? 'signup' : 'password', { email: form.get('email'), password: form.get('password') })
    busy.value = false
  }
  return (
    <form class="signin-email" onSubmit={(e) => submit(e as unknown as SubmitEvent)}>
      <input class="input" name="email" type="email" required autocomplete="username" placeholder={t('m.email')} aria-label={t('m.email')} />
      <input class="input" name="password" type="password" required minLength={8} autocomplete="current-password" placeholder={t('encryption.password')} aria-label={t('encryption.password')} />
      <Button type="submit" class="btn-block" disabled={busy.value}>{t('home.signIn')}</Button>
      <button type="submit" class="btn btn-text" value="signup" disabled={busy.value}>{t('m.signUp')}</button>
    </form>
  )
}

// Telegram's login popup behind our own button (telegram-widget.js provides Telegram.Login.auth). The script loads
// when the dialog opens: browsers only allow the popup straight from the click
function loadTelegram() {
  if (document.getElementById('telegram-login')) return
  const s = document.createElement('script')
  s.id = 'telegram-login'
  s.src = 'https://telegram.org/js/telegram-widget.js?22'
  document.head.append(s)
}
const telegramLogin = (onAuth: (user: object) => void) =>
  (window as any).Telegram?.Login.auth({ bot_id: 774889217, request_access: 'write', lang: language.value }, (user: object | false) => user && onAuth(user))

const TEN_MINUTES = 600

/** Log in by scanning a one-time code with a logged in phone: GET a uuid, poll until the app attaches its token */
function QrLogin({ close, onToken }: { close: () => void; onToken: (token: string) => void }) {
  const code = useSignal('')
  const left = useSignal(TEN_MINUTES)
  useEffect(() => {
    let alive = true
    // Only this tab knows the secret behind the code: someone who sees (or photographs) the QR can't collect the token
    let secret = ''
    const regenerate = async () => {
      left.value = TEN_MINUTES
      secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
      const hash = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
      call<{ uuid: string }>('GET', `/login/generate_uuid?hash=${hash}`, undefined, '').then((r) => alive && (code.value = r.uuid), showError)
    }
    regenerate()
    const tick = setInterval(() => (left.value <= 1 ? regenerate() : left.value--), 1000)
    const poll = setInterval(async () => {
      if (!code.value) return
      const r = await call<{ token?: string }>('POST', '/login/qr_check', { uuid: code.value, secret }, '').catch(() => null)
      if (r?.token && alive) (alive = false), onToken(r.token)
    }, 5000)
    return () => {
      alive = false
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [])
  const mm = String(Math.floor(left.value / 60)).padStart(2, '0')
  const ss = String(left.value % 60).padStart(2, '0')
  return (
    <DialogCard title={t('qr.code')} actions={<Button text onClick={close}>{t('close')}</Button>}>
      <p>{t('qr.description.web_login')}</p>
      <div class="qr">
        {code.value ? <QrCode text={code.value} /> : <Spinner />}
        <span aria-live="off">{mm}:{ss}</span>
      </div>
    </DialogCard>
  )
}

function QrCode({ text }: { text: string }) {
  const m = qr(text)
  const d = m.flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : []))).join('')
  return (
    <svg class="qr-code" viewBox={`-4 -4 ${m.length + 8} ${m.length + 8}`} role="img" aria-label={t('qr.code')} shape-rendering="crispEdges">
      <path d={d} fill="#000" />
    </svg>
  )
}

// endregion
