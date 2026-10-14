import type { JSX } from 'preact'
import { useEffect, useMemo } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { deleteAccount, logout } from '../data/account'
import { call } from '../data/rest'
import {
  encryptionKey, hero, isDark, people, prefs, rev, session, setName, setPref, setSetting, settings, tags, todos, update,
  type Person, type Settings as Synced, type Tag,
} from '../data/store'
import { connected, hardSync, sync, syncing } from '../data/sync'
import { LANGUAGES, language, setLanguage, t, tRaw, type Language } from '../i18n'
import { decrypt } from '../lib/crypto'
import { qr } from '../lib/qr'
import { useSignal } from '../lib/state'
import { ellipsize } from '../lib/text'
import { RANKS, rank } from '../logic/hero'
import { isMine, liveTags, renameTag, unreadable } from '../logic/todos'
import {
  Button, Caption, confirm, DialogCard, Field, HeroButton, IconButton, InfoButton, LargeTitle, open, SectionDivider, showError,
  showSupport, Spinner, Switch, TableRow, toast, TopBar,
} from '../ui/kit'
import { go } from '../ui/router'
import { Report } from './Report'
import './Settings.css'

const VERSION: string | undefined = import.meta.env.VITE_VERSION
/** Stable callback ref: focuses the first input inside once mounted */
const focusInput = (el: HTMLElement | null) => el?.querySelector('input')?.focus()
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast(`"${ellipsize(text, 40)}" ${t('m.copied')}`), showError)

/** Busy flag around an async job, errors shown as a snackbar */
async function busyWhile(busy: { value: boolean }, job: () => Promise<unknown>) {
  busy.value = true
  try {
    await job()
  } catch (e) {
    showError(e)
  } finally {
    busy.value = false
  }
}

// region Settings tab and its stack pages

let listScroll = 0
/** Opens a stack page, remembering where the list was scrolled to */
const nav = (page: string) => () => {
  listScroll = scrollY
  go(`/settings/${page}`)
}

const PAGES: Record<string, { title: () => string; info?: string; body: () => JSX.Element }> = {
  rules: { title: () => t('m.howTo'), info: 'm.infoRules', body: Rules },
  devices: { title: () => t('m.addDevices'), body: Devices },
  hashtags: { title: () => t('m.tags'), info: 'm.infoTags', body: Hashtags },
  delegators: { title: () => t('m.delegate.delegators'), body: () => <People delegators /> },
  delegates: { title: () => t('m.delegate.delegates'), body: () => <People /> },
  security: { title: () => t('m.security'), body: Security },
  stats: { title: () => t('report.title'), body: Report },
  data: { title: () => t('m.dataInfo'), info: 'm.infoData', body: Data },
  apps: { title: () => t('apps'), body: Apps },
  hero: { title: () => t('m.heroProfileTitle'), info: 'm.infoHero', body: Hero },
}

/** The settings list like the app's, with its stack pages at /settings/<page> */
export function Settings({ page }: { page?: string }) {
  rev.value
  useEffect(() => scrollTo(0, page ? 0 : listScroll), [page])
  const sub = page ? PAGES[page] : undefined
  if (!sub) return <List />
  return (
    <>
      <TopBar title={sub.title()} onBack={() => go('/settings')} actions={sub.info && <InfoButton text={sub.info} />} />
      <sub.body />
    </>
  )
}

/** The Security page, where the encryption password is set */
export const openEncryption = () => go('/settings/security')

type Flag = { [K in keyof Synced]-?: Synced[K] extends boolean | undefined ? K : never }[keyof Synced]
type LocalFlag = 'sound' | 'gamification' | 'askBeforeDelete' | 'hotkeys' | 'swipe' | 'newLineOnReturn' | 'coloredCards'
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

function List() {
  const s = settings.value
  const p = prefs.value
  const user = session.value
  const synced = (key: Flag, label: string) => <Switch row checked={!!s[key]} onChange={(v) => setSetting(key, v)} label={label} />
  const local = (key: LocalFlag, label: string) => <Switch row checked={p[key]} onChange={(v) => setPref(key, v)} label={label} />
  const ids: [string, string | undefined][] = user
    ? [[t('m.email'), user.email ?? user.passwordLogin], [t('m.facebook'), user.facebookId], [t('m.telegram'), user.telegramId], [t('m.apple'), user.appleSubId]]
    : []
  return (
    <div class="settings">
      <LargeTitle title={t('settings.title')} info="m.infoSettings">
        <HeroButton />
      </LargeTitle>

      <SectionDivider />
      <Caption>{t('m.important')}</Caption>
      <TableRow label={t('m.howToUse')} onClick={nav('rules')} />

      <SectionDivider />
      <Caption>{t('m.account')}</Caption>
      {user && <NameRow name={user.name} />}
      {ids.map(([label, id]) => id && <TableRow key={label} label={label} value={id} onClick={() => copy(id)} />)}
      <TableRow label={t('m.addDevices')} onClick={nav('devices')} />
      <div class="logout">
        <button type="button" class="btn btn-orange btn-block" onClick={async () => (await confirm(t('m.logoutText'), t('m.logout'), true)) && logout()}>
          {t('m.logout')}
        </button>
        <button type="button" class="btn btn-text danger btn-block" onClick={async () => (await confirm(t('m.deleteAccountText'), t('m.deleteAccount'), true)) && deleteAccount()}>
          {t('m.deleteAccount')}
        </button>
      </div>

      <SectionDivider />
      <Caption>{t('m.todos')}</Caption>
      {synced('showTodayOnAddTodo', t('m.defaultToToday'))}
      {synced('newTodosGoFirst', t('m.newTodosGoOnTop'))}
      {synced('preserveOrderByTime', t('m.preserveOrderByTime'))}
      {local('askBeforeDelete', t('m.askBeforeDelete'))}
      {synced('duplicateTagInBreakdown', t('m.settingsObject.duplicateTagInBreakdown'))}
      {synced('showMoreByDefault', t('m.settingsObject.showMoreByDefault'))}
      <Picker
        label={t('m.firstDayOfWeek')}
        value={String(s.firstDayOfWeek ?? (language.value === 'en' ? 0 : 1))}
        options={WEEKDAYS.map((d) => [String(d), t(`weekday${d}`)])}
        onChange={(v) => setSetting('firstDayOfWeek', +v)}
      />
      <label class="table-row">
        <span class="label">{t('m.startTimeOfDay')}</span>
        <input type="time" class="time-input" value={s.startTimeOfDay || '00:00'} onClick={showPicker} onChange={(e) => setSetting('startTimeOfDay', e.currentTarget.value || '00:00')} />
      </label>
      <TableRow label={t('m.tags')} onClick={nav('hashtags')} />

      <SectionDivider />
      <Caption>{t('delegate.title')}</Caption>
      <InviteRow />
      <TableRow label={t('m.delegate.delegators')} onClick={nav('delegators')} />
      <TableRow label={t('m.delegate.delegates')} onClick={nav('delegates')} />

      <SectionDivider />
      <Caption>{t('m.general')}</Caption>
      <Picker
        label={t('m.languageSelect')}
        value={language.value}
        options={Object.entries(LANGUAGES)}
        onChange={(v) => {
          setLanguage(v as Language)
          setSetting('language', v)
        }}
      />
      <Picker
        label={t('m.colorMode')}
        value={p.colorMode}
        options={[['auto', t('m.languageAuto')], ['dark', t('m.dark')], ['light', t('m.light')]]}
        onChange={(v) => setPref('colorMode', v as typeof p.colorMode)}
      />
      <TableRow label={t('m.security')} onClick={nav('security')} />
      {local('sound', t('m.soundEffects'))}
      {local('gamification', t('m.gamification'))}
      {local('hotkeys', t('settings.hotkeys'))}
      {p.hotkeys && local('newLineOnReturn', t('settings.newLineOnReturn'))}
      {local('swipe', t('m.settingsActions.swipeActions'))}
      {local('coloredCards', t('settings.coloredCardBackgrounds'))}

      <SectionDivider />
      <Caption>{t('m.info')}</Caption>
      <TableRow label={t('report.title')} onClick={nav('stats')} />
      <TableRow label={t('m.dataInfo')} onClick={nav('data')} />
      <TableRow label={t('apps')} onClick={nav('apps')} />
      {p.gamification && <TableRow label={t('m.heroProfileTitle')} onClick={nav('hero')} />}
      <TableRow label={t('m.termsOfUse')} href="/terms" />
      <TableRow label={t('m.privacyPolicy')} href="/privacy" />
      <TableRow label={t('m.supportLabel')} onClick={showSupport} />
      {VERSION && <TableRow label={<span class="muted">v{VERSION}</span>} />}
    </div>
  )
}

/** A value row whose value is picked with the platform's own picker: an invisible native select covers the row */
function Picker(p: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <label class="table-row picker">
      <span class="label">{p.label}</span>
      <span class="value">{p.options.find(([v]) => v === p.value)?.[1]}</span>
      <Icon name="chevron_right" size={20} class="chevron" />
      <select aria-label={p.label} value={p.value} onChange={(e) => p.onChange(e.currentTarget.value)}>
        {p.options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
      </select>
    </label>
  )
}

/** Opens the time picker right away instead of focusing the first segment (where supported) */
function showPicker(e: Event) {
  try {
    ;(e.currentTarget as HTMLInputElement).showPicker()
  } catch {}
}

/** The name, edited in place like the app */
function NameRow({ name }: { name: string }) {
  const draft = useSignal<string | null>(null)
  if (draft.value === null) return <TableRow label={t('m.nameLabel')} value={name} onClick={() => (draft.value = name)} />
  const value = draft.value.trim()
  const valid = value.length > 0 && value.length <= 250
  const save = () => valid && (setName(value), (draft.value = null))
  return (
    <form ref={focusInput} class="table-row name-form" onSubmit={(e) => (e.preventDefault(), save())}>
      <input
        aria-label={t('m.nameLabel')} value={draft.value} maxLength={250}
        onInput={(e) => (draft.value = e.currentTarget.value)} onKeyDown={(e) => e.key === 'Escape' && (draft.value = null)}
      />
      <IconButton icon="close" title={t('cancel')} onClick={() => (draft.value = null)} />
      <IconButton icon="check" title={t('save')} disabled={!valid} onClick={save} />
    </form>
  )
}

// endregion

// region Delegation

const inviteLink = () => (session.value?.delegateInviteToken ? `https://todorant.com/invite/${session.value.delegateInviteToken}` : '')
const copyInviteLink = () => inviteLink() && copy(inviteLink())

function InviteRow() {
  const busy = useSignal(false)
  const link = inviteLink()
  const reset = async () => {
    if (!(await confirm(t('m.delegate.resetConfirmation'), t('m.delegate.resetLink'), true))) return
    busyWhile(busy, async () => {
      const { token } = await call<{ token: string }>('POST', '/v2/delegation/token')
      if (session.value) session.value = { ...session.value, delegateInviteToken: token }
    })
  }
  return (
    <div class="table-row">
      <span class="label">
        {t('m.delegate.link')}
        <span class="sub">{link}</span>
      </span>
      <IconButton icon="content_copy" title={t('m.delegate.link')} disabled={!link} onClick={copyInviteLink} />
      <IconButton icon="refresh" title={t('m.delegate.resetLink')} disabled={busy.value} onClick={reset} />
    </div>
  )
}

/** Delegators or delegates, removable; the tasks shared with a removed person go away here too, like in the apps */
function People({ delegators = false }: { delegators?: boolean }) {
  const busy = useSignal(false)
  const users = delegators ? people.value.delegators : people.value.delegates
  const remove = async (user: Person) => {
    if (!(await confirm(t(delegators ? 'm.delegate.deleteDelegatorConfirmation' : 'm.delegate.deleteDelegateConfirmation'), t('delete'), true))) return
    busyWhile(busy, async () => {
      await call('DELETE', `/v2/delegation/${delegators ? 'delegators' : 'delegates'}/${user.id}`)
      for (const todo of [...todos.values()])
        if (!todo.deleted && (delegators ? todo.delegator === user.id : todo.user === user.id && todo.delegator === session.value?.id))
          update('todo', todo.id, { deleted: true, delegateAccepted: true })
      sync()
    })
  }
  return (
    <>
      {!delegators && <InviteRow />}
      {!users.length && <p class="settings-note">{t(delegators ? 'm.delegate.noDelegators' : 'm.delegate.noDelegates')}</p>}
      {users.map((user) => (
        <div key={user.id} class="table-row">
          <span class="label ellipsis">{user.name}</span>
          <IconButton icon="delete" color="var(--red)" title={`${t('delete')} ${user.name}`} disabled={busy.value} onClick={() => remove(user)} />
        </div>
      ))}
    </>
  )
}

// endregion

// region Rules, welcome, devices, apps

function Rules() {
  return (
    <>
      <ol class="rules">{(tRaw('rules') as string[]).map((r, i) => <li key={i}>{r}</li>)}</ol>
      <Caption>{t('howto.bonus.title')}</Caption>
      <ul class="rules">{(tRaw('howto.bonus.rules') as string[]).map((r, i) => <li key={i}>{r}</li>)}</ul>
      <SectionDivider />
      <TableRow label={t('introButton')} onClick={openWelcome} />
    </>
  )
}

const SLIDES = [
  ['introText0web', 'introText1', 'introText2web'],
  ['introText3', 'introText4', 'introText5'],
  ['introText6', 'introText7', 'introText8'],
  ['introText9', 'introText10', 'introText11'],
  ['introText12', 'introText14web', 'introText15'],
]

/** Nikita's welcome carousel, shown once after the first sign in */
export const openWelcome = () => open((close) => <Welcome close={close} />, true)

function Welcome({ close }: { close: () => void }) {
  const index = useSignal(0)
  const i = index.value
  const last = i === SLIDES.length - 1
  return (
    <DialogCard
      actions={
        <>
          {i > 0 && <Button text onClick={() => index.value--}>{t('back')}</Button>}
          <span class="grow" />
          <Button autofocus onClick={() => (last ? close() : index.value++)}>{t(last ? 'letsGo' : 'next')}</Button>
        </>
      }
    >
      <div class="welcome" aria-live="polite">
        {i === 0 ? <img class="badge" src="/img/nikita.webp" alt="Nikita Kolmogorov" width={88} height={88} /> : <div class="badge">{last ? '😋' : i}</div>}
        {SLIDES[i].map((k) => <p key={k}>{t(k)}</p>)}
      </div>
      <div class="dots">
        {SLIDES.map((_, k) => (
          <button key={k} type="button" class={k === i ? 'on' : ''} aria-label={`${k + 1} / ${SLIDES.length}`} aria-current={k === i} onClick={() => (index.value = k)} />
        ))}
      </div>
    </DialogCard>
  )
}

/** The session token as a QR code that the mobile apps scan to log in ("Login with QR") */
function Devices() {
  const token = session.value?.token
  return (
    <div class="page-content devices">
      <p class="muted">{t('qr.description.app_login')}</p>
      {token && <QrCode text={token} />}
    </div>
  )
}

/** Rounded-dot QR in the Todorant gradient with the logo in the middle */
function QrCode({ text }: { text: string }) {
  const { n, logo, from, dots, finders } = useMemo(() => {
    const m = qr(text)
    const n = m.length
    const logo = Math.round(n * 0.11) * 2 + 1
    const from = (n - logo) / 2
    const inLogo = (x: number, y: number) => x >= from && x < from + logo && y >= from && y < from + logo
    const inFinder = (x: number, y: number) => (x < 7 || x >= n - 7) && (y < 7 || y >= n - 7) && !(x >= n - 7 && y >= n - 7)
    let dots = ''
    m.forEach((row, y) => row.forEach((dark, x) => {
      if (dark && !inFinder(x, y) && !inLogo(x, y)) dots += `M${x + 0.05} ${y + 0.5}a.45 .45 0 1 0 .9 0a.45 .45 0 1 0-.9 0`
    }))
    return { n, logo, from, dots, finders: [[0, 0], [n - 7, 0], [0, n - 7]] }
  }, [text])
  return (
    <svg class="devices-qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={t('qr.code')}>
      <defs>
        <linearGradient id="qr-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={n} y2={n}>
          <stop offset="0" stop-color="#F36427" />
          <stop offset="1" stop-color="#3C66F5" />
        </linearGradient>
      </defs>
      <rect x="-2" y="-2" width={n + 4} height={n + 4} rx="3" fill="#fff" />
      <g fill="url(#qr-gradient)" stroke="url(#qr-gradient)">
        <path d={dots} stroke="none" />
        {finders.map(([x, y]) => (
          <g key={`${x},${y}`}>
            <rect x={x + 0.5} y={y + 0.5} width="6" height="6" rx="2.2" fill="none" stroke-width="1" />
            <circle cx={x + 3.5} cy={y + 3.5} r="1.5" stroke="none" />
          </g>
        ))}
      </g>
      <image href="/img/todorant-squircle.webp" x={from + 0.3} y={from + 0.3} width={logo - 0.6} height={logo - 0.6} />
    </svg>
  )
}

const PLANE = <svg viewBox="0 0 24 24" width="28" height="28" fill="#2aabee" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
const APPS: [name: string, url: string, icon: JSX.Element][] = [
  ['iOS', 'https://apps.apple.com/app/todorant/id1482078243', <img src="/img/appstore.svg" alt="" width={28} height={28} />],
  ['Google Play', 'https://play.google.com/store/apps/details?id=com.todorant', <img src="/img/playstore.svg" alt="" width={28} height={28} />],
  ['Android APK', 'https://github.com/backmeupplz/todorant/releases', <Icon name="apps" size={28} style={{ color: 'var(--green)' }} />],
  ['Telegram', 'https://t.me/todorant_bot', PLANE],
]

function Apps() {
  return <>{APPS.map(([name, url, icon]) => <TableRow key={name} label={<span class="row app">{icon}{name}</span>} href={url} />)}</>
}

// endregion

// region Hero

/** Each rank's color, like the apps' hero screen */
const RANK_COLORS = [
  '#cc8f8f', '#cc9b8f', '#cca78f', '#ccae8f', '#ccb48f', '#ccba8f', '#ccc08f', '#ccc68f', '#cccc8f', '#c0cc8f', '#b4cc8f', '#9bcc8f',
  '#72a372', '#648f7d', '#567a7a', '#647d8f', '#727ea3', '#6a6a8f', '#62567a', '#65567a', '#6e567a', '#7a567a', '#a37297', '#b88199',
]
const rankColor = (i: number) => RANK_COLORS[i % RANK_COLORS.length]

/** Points to the next rank, the current rank and every rank passed */
function Hero() {
  const points = hero.value
  const { level, rank: current, next, progress } = rank(points)
  // Past the last threshold: the "infinity" rank
  const top = current === next
  return (
    <div class="hero-page">
      {!top && <Goal color={rankColor(level + 1)} points={next} />}
      <Rank points={top ? -1 : current} color={rankColor(level)} progress={progress} left={top ? undefined : next - points} />
      {!top && <Goal color={rankColor(level)} points={current} />}
      {level > 0 && <SectionDivider />}
      {RANKS.slice(0, level).map((r, i) => <Rank key={r} points={r} color={rankColor(i)} progress={1} />).reverse()}
    </div>
  )
}

const Goal = (p: { color: string; points: number }) => (
  <div class="rank-goal" style={{ color: p.color }}>
    <i />
    {p.points} {t('m.points')}
  </div>
)

const Rank = (p: { points: number; color: string; progress: number; left?: number }) => (
  <div class="rank">
    <div class="rank-line"><i style={{ height: `${Math.round(Math.min(1, Math.max(0, p.progress)) * 100)}%`, background: p.color }} /></div>
    <div class="rank-body">
      {p.left !== undefined && <p>{p.left} {t('m.pointsTillNextLevel')}</p>}
      <div class="rank-card">
        <span>{t('m.level')} {p.points < 0 ? '∞' : p.points}</span>
        <b>{t(`rank${p.points}Title`)}</b>
      </div>
      <p>{t(`rank${p.points}Description`)}</p>
    </div>
  </div>
)

// endregion

// region Data

function Data() {
  const list = [...todos.values()]
  const result = (ok: boolean) => toast(ok ? t('success') : t('m.notConnected'), !ok)
  return (
    <>
      <Caption>{t('m.count')}</Caption>
      <TableRow label={t('m.todoCount')} value={list.filter((x) => !x.deleted).length} />
      <TableRow label={t('m.tagsCount')} value={liveTags().length} />
      <TableRow label={t('m.delegate.delegators')} value={people.value.delegators.length} />
      <TableRow label={t('m.delegate.delegates')} value={people.value.delegates.length} />
      <SectionDivider />
      <Caption>{t('m.sync')}</Caption>
      <TableRow label={t('m.connected')}>
        {syncing.value ? <Spinner /> : <Icon name={connected.value ? 'check' : 'close'} style={{ color: connected.value ? 'var(--green)' : 'var(--red)' }} />}
      </TableRow>
      <TableRow label={t('m.syncData')} onClick={() => sync().then(result)} />
      <TableRow label={t('m.syncDataHard')} onClick={() => hardSync().then(result)} />
      <TableRow label={t('settings.export')} onClick={exportTodos} />
    </>
  )
}

/** todo.txt of everything, computed locally (texts are already decrypted here, unlike the server export) */
function exportTodos() {
  const lines = [...todos.values()]
    .filter((x) => isMine(x) && x.monthAndYear)
    .sort((a, b) => Number(b.completed) - Number(a.completed))
    .map((x) => {
      const due = x.date ? `${x.monthAndYear}-${x.date}` : x.monthAndYear
      const created = new Date(x.createdAt ?? Date.now()).toISOString().slice(0, 10)
      return x.completed ? `x ${due} ${created} ${x.text} due:${due}` : `${x.text} due:${due}`
    })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }))
  a.download = 'todo.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// endregion

// region Security (encryption)

function Security() {
  const stored = encryptionKey.value
  const on = useSignal(!!stored)
  const password = useSignal(stored ?? '')
  const repeat = useSignal(stored ?? '')
  const show = useSignal(false)
  const own = [...todos.values()].filter((x) => !x.deleted && !x.delegator)
  const encrypted = own.filter((x) => x.encrypted).length
  const savable = on.value && !!password.value && password.value !== stored && password.value === repeat.value

  async function toggle(value: boolean) {
    if (value || !stored) return void (on.value = value)
    if (!(await confirm(t('m.encryptionDisableConfirm'), t('m.disable'), true))) return
    encryptionKey.value = null
    on.value = false
    password.value = repeat.value = ''
    // Local texts were decrypted; fetch what the server really has
    hardSync()
  }

  async function save() {
    if (!savable || !(await confirm(t('m.encryptionConfirm'), t('save')))) return
    const key = password.value
    if (!stored) {
      // Without a key, encrypted texts are still ciphertext here; the new password has to decrypt them
      const sample = own.find(unreadable)
      if (sample && !(await decrypt(sample.text, key))) return toast(t('m.passwordError'), true)
      encryptionKey.value = key
      hardSync()
    } else {
      encryptionKey.value = key
      // A new password: toggling the flag sends each encrypted text again, encrypted with the new key.
      // Texts this browser can't read stay as they are, or they'd be encrypted twice.
      for (const x of own) if (x.encrypted && !unreadable(x)) update('todo', x.id, { encrypted: false }), update('todo', x.id, { encrypted: true })
    }
    toast(t('m.encryption.encryptionSaved'))
  }

  const all = async (encrypt: boolean) => {
    if (!(await confirm(t(encrypt ? 'm.confirmEncryptAll' : 'm.confirmDecryptAll'), t(encrypt ? 'm.encryptAllButton' : 'm.decryptAllButton'), !encrypt))) return
    // Unreadable texts are ciphertext: sending them as plain text would garble them for good
    for (const x of own) if (x.encrypted !== encrypt && !unreadable(x)) update('todo', x.id, { encrypted: encrypt })
  }

  const field = (label: string, s: typeof password) => (
    <Field label={label} type={show.value ? 'text' : 'password'} autocomplete="new-password" value={s.value} error={!s.value} onInput={(e) => (s.value = e.currentTarget.value)} />
  )
  return (
    <>
      <p class="settings-note">{t('m.infoSecurity')}</p>
      <Switch row checked={on.value} onChange={toggle} label={t('m.encryptTodo')} />
      {on.value && (
        <form class="page-content passwords" onSubmit={(e) => (e.preventDefault(), save())}>
          <div class="row password-row">
            <div class="grow">{field(t('m.password'), password)}</div>
            <IconButton icon={show.value ? 'eye_off' : 'eye'} title={t('m.password')} onClick={() => (show.value = !show.value)} />
          </div>
          {field(t('m.encryption.repeatPassword'), repeat)}
          {savable && <Button type="submit" class="btn-block">{t('save')}</Button>}
        </form>
      )}
      <SectionDivider />
      <Caption>{t('m.count')}</Caption>
      <TableRow label={t('m.encryptedTodos')} value={encrypted} />
      <TableRow label={t('m.unencryptedTodos')} value={own.length - encrypted} />
      <SectionDivider />
      <Caption>{t('m.general')}</Caption>
      <div class="page-content">
        <Button class="btn-block" disabled={!stored || encrypted === own.length} onClick={() => all(true)}>{t('m.encryptAllButton')}</Button>
        <Button class="btn-block" disabled={!stored || !encrypted} onClick={() => all(false)}>{t('m.decryptAllButton')}</Button>
      </div>
    </>
  )
}

// endregion

// region Hashtags

const PRESETS = {
  light: ['#FFBE3D', '#FF984C', '#FF715B', '#2DCA8C', '#32A4C6', '#377DFF', '#4740D6', '#5603AD'],
  dark: ['#FFBE3D', '#FF984C', '#FF715B', '#6cdaaf', '#32A4C6', '#70bfd7', '#23738b', '#ab81d6'],
}

/** Epics first (drag or arrow keys to reorder), then the rest; each tag can be edited, made an epic or deleted */
function Hashtags() {
  const list = liveTags()
  const selected = useSignal<{ id: string; mode: 'edit' | 'epic' } | null>(null)
  const order = useSignal<string[] | null>(null)
  const epics = order.value ?? list.filter((x) => x.epic).map((x) => x.id)
  const commit = (ids: string[]) => ids.forEach((id, i) => update('tag', id, { epicOrder: i }))
  const move = (id: string, to: number) => {
    const next = epics.filter((x) => x !== id)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, id)
    return next
  }
  const handle = (id: string): JSX.HTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (e) => (e.currentTarget.setPointerCapture(e.pointerId), (order.value = epics)),
    onPointerMove: (e) => {
      if (!order.value) return
      const over = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-epic]') as HTMLElement | null)?.dataset.epic
      if (over && over !== id) order.value = move(id, epics.indexOf(over))
    },
    onPointerUp: () => order.value && (commit(order.value), (order.value = null)),
    onPointerCancel: () => (order.value = null),
    onKeyDown: (e) => {
      const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (d) e.preventDefault(), commit(move(id, epics.indexOf(id) + d))
    },
  })
  const byId = new Map(list.map((x) => [x.id, x]))
  const sorted = [...epics.map((id) => byId.get(id)!).filter(Boolean), ...list.filter((x) => !x.epic)]
  const deleteAll = async () => {
    if (await confirm(t('m.deleteAllHashtagsConfirm'), t('delete'), true)) list.forEach((x) => update('tag', x.id, { deleted: true }))
  }
  return (
    <>
      {list.length ? <TableRow danger label={t('m.deleteAllHashtags')} onClick={deleteAll} /> : <p class="settings-note">{t('m.emptyHashtags')}</p>}
      {sorted.map((tag) => (
        <TagRow
          key={tag.id}
          tag={tag}
          mode={selected.value?.id === tag.id ? selected.value.mode : undefined}
          select={(mode) => (selected.value = mode ? { id: tag.id, mode } : null)}
          handle={tag.epic && epics.length > 1 ? handle(tag.id) : undefined}
          dragging={order.value !== null && tag.epic}
        />
      ))}
    </>
  )
}

function TagRow(p: { tag: Tag; mode?: 'edit' | 'epic'; select: (mode?: 'edit' | 'epic') => void; handle?: JSX.HTMLAttributes<HTMLButtonElement>; dragging: boolean }) {
  const { tag, mode } = p
  const name = useSignal(tag.tag)
  const color = useSignal(tag.color || '')
  const goal = useSignal('')
  const shown = (mode === 'edit' && color.value) || tag.color || 'var(--link)'
  const nameOk = /^\S+$/.test(name.value)
  const goalOk = /^\d+$/.test(goal.value) && +goal.value > 0
  const toggle = (m: 'edit' | 'epic') => {
    name.value = tag.tag
    color.value = tag.color || ''
    goal.value = ''
    p.select(mode === m ? undefined : m)
  }
  const saveTag = () => {
    if (!nameOk) return
    if (name.value !== tag.tag) renameTag(tag, name.value)
    if (color.value && color.value !== tag.color) update('tag', tag.id, { color: color.value })
    p.select()
  }
  const makeEpic = () => {
    if (!goalOk) return
    const last = Math.max(-1, ...[...tags.values()].filter((x) => x.epic && !x.deleted).map((x) => x.epicOrder))
    update('tag', tag.id, { epic: true, epicGoal: +goal.value, epicPoints: 0, epicCompleted: false, epicOrder: last + 1 })
    p.select()
  }
  const unEpic = async () => {
    if (await confirm(`${t('m.unEpicConfirm')} "#${ellipsize(tag.tag, 50)}"?`, t('m.unEpic'), true))
      update('tag', tag.id, { epic: false, epicPoints: 0, epicCompleted: false, epicGoal: 0, epicOrder: 0 })
  }
  const remove = async () => {
    if (await confirm(`${t('m.deleteTodo')} "#${ellipsize(tag.tag, 50)}"?`, t('delete'), true)) update('tag', tag.id, { deleted: true })
  }
  return (
    <div class={`tag-row${p.dragging ? ' dragging' : ''}`} data-epic={tag.epic ? tag.id : undefined}>
      <div class="tag-line">
        {p.handle && (
          <button type="button" class="icon-btn tag-handle" title="Drag to reorder (or use arrow keys)" aria-label={`Reorder #${tag.tag}`} {...p.handle}>
            <Icon name="drag_indicator" size={20} />
          </button>
        )}
        <span class="tag-name" style={{ color: shown }}>#{tag.tag}</span>
        {mode !== 'edit' &&
          (tag.epic ? (
            <IconButton icon="epic" title={t('m.unEpic')} color="var(--orange)" onClick={unEpic} />
          ) : (
            <IconButton icon={mode === 'epic' ? 'close' : 'epic'} title={mode === 'epic' ? t('cancel') : t('m.epic.intoEpic')} onClick={() => toggle('epic')} />
          ))}
        {mode !== 'epic' && <IconButton icon={mode === 'edit' ? 'close' : 'edit'} title={mode === 'edit' ? t('cancel') : t('m.editHashtag')} onClick={() => toggle('edit')} />}
        <IconButton icon="delete" title={t('delete')} color="var(--red)" onClick={remove} />
      </div>
      {tag.epic && (
        <div class="tag-progress" style={{ color: shown }}>
          <span>{tag.epicPoints}</span>
          <div class="epic-bar"><i style={{ width: `${Math.min(100, (tag.epicPoints / (tag.epicGoal || 1)) * 100)}%`, background: shown }} /></div>
          <span>{tag.epicGoal}</span>
        </div>
      )}
      {mode === 'edit' && (
        <form ref={focusInput} class="tag-form" onSubmit={(e) => (e.preventDefault(), saveTag())}>
          <Field label={t('m.editName')} value={name.value} error={!nameOk} onInput={(e) => (name.value = e.currentTarget.value)} />
          {!nameOk && <span class="field-error">{t('errors.tag.whitespaces')}</span>}
          <div class="swatches" role="group" aria-label={t('m.changeColor')}>
            {PRESETS[isDark() ? 'dark' : 'light'].map((c) => (
              <button key={c} type="button" class={`swatch${color.value === c ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={c} aria-pressed={color.value === c} onClick={() => (color.value = c)} />
            ))}
            <label class="swatch custom" title={t('m.changeColor')}>
              <input type="color" aria-label={t('m.changeColor')} value={/^#[\da-f]{6}$/i.test(color.value) ? color.value : '#1e88e5'} onInput={(e) => (color.value = e.currentTarget.value)} />
            </label>
            <span class="grow" />
            <Button small type="submit" disabled={!nameOk}>{t('save')}</Button>
          </div>
        </form>
      )}
      {mode === 'epic' && (
        <form ref={focusInput} class="tag-form" onSubmit={(e) => (e.preventDefault(), makeEpic())}>
          <p class="muted">{t('epic.epicForeword')}</p>
          <div class="row">
            <Field
              class="grow" label={t('m.epic.epicGoal')} type="number" min={1} step={1} inputMode="numeric" value={goal.value}
              error={!!goal.value && !goalOk} onInput={(e) => (goal.value = e.currentTarget.value)}
            />
            <Button small type="submit" class="epic-save" disabled={!goalOk}>{t('m.epic.intoEpic')}</Button>
          </div>
          {!!goal.value && !goalOk && <span class="field-error">{t(/^\d+$/.test(goal.value) ? 'errors.epic.greaterThanZeroError' : 'm.errors.epic.numberError')}</span>}
        </form>
      )}
    </div>
  )
}

// endregion
