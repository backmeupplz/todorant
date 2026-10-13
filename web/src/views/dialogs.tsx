import { useSignal } from '../lib/state'
import type { ComponentChildren, JSX } from 'preact'
import { useMemo } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { call } from '../data/rest'
import {
  encryptionKey, hero, prefs, rev, session, setName, setPref, setSetting, settings, tags, todos, update, type Settings, type Tag,
} from '../data/store'
import { connected, hardSync, sync, syncing } from '../data/sync'
import { LANGUAGES, language, setLanguage, t, tRaw, type Language } from '../i18n'
import { decrypt } from '../lib/crypto'
import { qr } from '../lib/qr'
import { isMine, liveTags, renameTag } from '../logic/todos'
import { Button, confirm, DialogCard, Field, IconButton, open, showError, Spinner, Switch, toast } from '../ui/kit'
import './dialogs.css'

/** A dialog with a title and a Close button */
const simple = (title: () => string, body: () => ComponentChildren, persistent = false) =>
  open((close) => <DialogCard title={title()} actions={<Button autofocus onClick={close}>{t('close')}</Button>}>{body()}</DialogCard>, persistent)

/** kit's Field, typed for input attributes (type, value, min…) */
export const Input = (p: JSX.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: boolean }) => <Field {...(p as object)} />

const Html = ({ html, tag = 'div' }: { html: string; tag?: 'div' | 'li' }) => {
  const Tag = tag
  return <Tag dangerouslySetInnerHTML={{ __html: html }} />
}

// region Support, rules, welcome, apps

export const openSupport = () => simple(() => t('supportAlert.title'), () => <Html html={t('supportAlert.text')} />)

export const openRules = () =>
  open(
    (close) => (
      <DialogCard
        title={t('howto.title')}
        actions={
          <>
            {session.value && <Button text onClick={() => (close(), openWelcome())}>{t('introButton')}</Button>}
            <Button autofocus onClick={close}>{t('cookie.button')}</Button>
          </>
        }
      >
        <ul class="rules">{(tRaw('rules') as string[]).map((r, i) => <Html key={i} tag="li" html={r} />)}</ul>
        <h3>{t('howto.bonus.title')}</h3>
        <ul class="rules">{(tRaw('howto.bonus.rules') as string[]).map((r, i) => <Html key={i} tag="li" html={r} />)}</ul>
      </DialogCard>
    ),
    true,
  )

const SLIDES = [
  ['introText0web', 'introText1', 'introText2web'],
  ['introText3', 'introText4', 'introText5'],
  ['introText6', 'introText7', 'introText8'],
  ['introText9', 'introText10', 'introText11'],
  ['introText12', 'introText14web', 'introText15'],
]

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
        {i === 0 ? <img class="badge" src="/img/nikita.webp" alt="Nikita Kolmogorov" width={100} height={100} /> : <div class="badge">{last ? '😋' : i}</div>}
        {SLIDES[i].map((k) => <p key={k}>{t(k)}</p>)}
      </div>
      <div class="dots">
        {SLIDES.map((_, k) => <button key={k} type="button" class={k === i ? 'on' : ''} aria-label={`${k + 1} / ${SLIDES.length}`} title={`${k + 1} / ${SLIDES.length}`} onClick={() => (index.value = k)} />)}
      </div>
    </DialogCard>
  )
}

const PLANE = <svg viewBox="0 0 24 24" width="32" height="32" fill="#2aabee" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
const APPS: [name: string, url: string, icon: JSX.Element][] = [
  ['iOS', 'https://apps.apple.com/app/todorant/id1482078243', <img src="/img/appstore.svg" alt="" height={34} />],
  ['Google Play', 'https://play.google.com/store/apps/details?id=com.todorant', <img src="/img/playstore.svg" alt="" height={34} />],
  ['Android APK', 'https://github.com/backmeupplz/todorant/releases', <Icon name="apps" size={32} />],
  ['Telegram', 'https://t.me/todorant_bot', PLANE],
]

export const openApps = () =>
  simple(
    () => t('apps'),
    () => (
      <div class="apps">
        {APPS.map(([name, url, icon]) => (
          <a key={name} href={url} target="_blank" rel="noopener noreferrer">{icon}<span>{name}</span></a>
        ))}
      </div>
    ),
  )

// endregion

// region Hero

const RANKS = [0, 5, 13, 42, 69, 85, 100, 221, 256, 300, 404, 777, 800, 1337, 1338, 2048, 9000, 12800, 1000000]

export const openHero = () => simple(() => t('heroProfileTitle'), () => <Hero />)

function Hero() {
  const points = hero.value
  const index = RANKS.findLastIndex((r) => r <= points)
  const rank = RANKS[index]
  const next = RANKS[index + 1]
  const row = (r: number, progress: number) => (
    <div class="rank" key={r}>
      <div class="rank-bar"><i style={{ height: `${progress}%`, background: `hsl(${(RANKS.indexOf(r) * 47) % 360} 70% 60%)` }} /></div>
      <div class="grow">
        <div class="rank-card"><b>{t('level')} {r}</b><div>{t(`rank${r}Title`)}</div></div>
        <p class="muted">{t(`rank${r}Description`)}</p>
      </div>
    </div>
  )
  return (
    <>
      <p>
        <b>{points}</b> {t('points')}
        {next !== undefined && <> · {next - points} {t('pointsTillNextLevel')}</>}
      </p>
      {row(rank, next === undefined ? 100 : Math.ceil(((points - rank) / (next - rank)) * 100))}
      {RANKS.slice(0, index).reverse().map((r) => row(r, 100))}
    </>
  )
}

// endregion

// region QR

export const openQr = () =>
  simple(() => t('qr.code'), () => (
    <>
      <p>{t('qr.description.app_login')}</p>
      {session.value && <QrCode text={session.value.token} />}
    </>
  ))

/** Rounded-dot QR in the Todorant gradient with the logo in the middle */
function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
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
  const { n, logo, from, dots, finders } = svg
  return (
    <svg class="qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={t('qr.code')}>
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

// endregion

// region Settings

export const openSettings = () => open((close) => <SettingsDialog close={close} />)

type Flag = { [K in keyof Settings]-?: Settings[K] extends boolean | undefined ? K : never }[keyof Settings]
type LocalFlag = 'sound' | 'hotkeys' | 'swipe' | 'newLineOnReturn' | 'coloredCards'
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

function SettingsDialog({ close }: { close: () => void }) {
  const s = settings.value
  const p = prefs.value
  const user = session.value
  const busy = useSignal(false)
  const synced = (key: Flag, label: string) => <Switch checked={!!s[key]} onChange={(v) => setSetting(key, v)} label={t(label)} />
  const local = (key: LocalFlag, label: string) => <Switch checked={p[key]} onChange={(v) => setPref(key, v)} label={t(label)} />
  const run = async (job: () => Promise<unknown>) => {
    busy.value = true
    try {
      await job()
    } catch (e) {
      showError(e)
    } finally {
      busy.value = false
    }
  }
  return (
    <DialogCard title={t('settings.title')} actions={<Button autofocus onClick={close}>{t('close')}</Button>}>
      <h3 class="subheader">{t('settings.general')}</h3>
      {synced('showTodayOnAddTodo', 'settings.showTodayOnAddTodo')}
      {synced('newTodosGoFirst', 'settings.newTodosGoFirst')}
      {synced('preserveOrderByTime', 'settings.preserveOrderByTime')}
      {synced('duplicateTagInBreakdown', 'settings.duplicateTagInBreakdown')}
      {synced('showMoreByDefault', 'settingsObject.showMoreByDefault')}
      {local('sound', 'soundEffects')}
      {local('hotkeys', 'settings.hotkeys')}
      {local('swipe', 'settingsActions.swipeActions')}
      {local('coloredCards', 'settings.coloredCardBackgrounds')}
      {p.hotkeys && local('newLineOnReturn', 'settings.newLineOnReturn')}
      {synced('removeCompletedFromCalendar', 'settings.removeCompletedFromCalendar')}
      <div class="settings-grid">
        <label class="field">
          <span>{t('settings.firstDayOfWeek')}</span>
          <select value={s.firstDayOfWeek ?? (language.value === 'en' ? 0 : 1)} onChange={(e) => setSetting('firstDayOfWeek', +e.currentTarget.value)}>
            {WEEKDAYS.map((d) => <option key={d} value={d}>{t(`weekday${d}`)}</option>)}
          </select>
        </label>
        <Input label={t('settings.startTimeOfDay')} type="time" value={s.startTimeOfDay || '00:00'} onChange={(e) => setSetting('startTimeOfDay', e.currentTarget.value || '00:00')} />
        <label class="field">
          <span>Language</span>
          <select
            value={language.value}
            onChange={(e) => {
              const lang = e.currentTarget.value as Language
              setLanguage(lang)
              setSetting('language', lang)
            }}
          >
            {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      </div>

      <h3 class="subheader">{t('settings.integrations')}</h3>
      <div class="row between">
        <span>{t('settings.googleCalendar')}</span>
        {s.googleCalendarCredentials ? (
          <Button text class="danger" disabled={busy.value} onClick={disconnectCalendar}>{t('settings.connected')}</Button>
        ) : (
          <Button text disabled={busy.value} onClick={() => connectCalendar(() => run(async () => (location.href = await call<string>('GET', '/google/calendarAuthenticationURL?web=true'))))}>
            <img src="/img/google.svg" alt="" width={18} height={18} class="google" /> {t('settings.notConnected')}
          </Button>
        )}
      </div>

      <h3 class="subheader">{t('settings.account')}</h3>
      {user && <NameEditor name={user.name} />}
      {user && [user.email, user.facebookId, user.telegramId, user.appleSubId].filter(Boolean).map((id) => <span key={id} class="muted">{id}</span>)}

      <h3 class="subheader">Data</h3>
      <div class="row wrap">
        <span class="grow">{syncing.value ? <Spinner /> : connected.value ? 'Synced live' : 'Offline'}</span>
        <Button text small onClick={() => sync().then((ok) => toast(ok ? t('success') : 'Offline', !ok))}>Sync now</Button>
        <Button text small onClick={() => hardSync().then((ok) => toast(ok ? t('success') : 'Offline', !ok))}>Hard sync</Button>
      </div>
      <div class="row wrap">
        <Button text small onClick={exportTodos}>{t('settings.export')}</Button>
        <Button text small onClick={() => (close(), openEncryption())}>{t('encryption.title')}</Button>
      </div>
    </DialogCard>
  )
}

function NameEditor({ name }: { name: string }) {
  const draft = useSignal<string | null>(null)
  if (draft.value === null)
    return (
      <div class="row">
        <b>{name}</b>
        <IconButton icon="edit" size={18} title={`${t('edit')} ${t('settings.username')}`} onClick={() => (draft.value = name)} />
      </div>
    )
  const value = draft.value.trim()
  const valid = value.length > 0 && value.length <= 250
  const save = () => valid && (setName(value), (draft.value = null))
  return (
    <form class="row" onSubmit={(e) => (e.preventDefault(), save())}>
      <Input class="grow" label={t('settings.username')} value={draft.value} maxLength={250} autofocus error={!valid} onInput={(e) => (draft.value = e.currentTarget.value)} />
      <IconButton icon="check" title={t('save')} disabled={!valid} onClick={save} />
      <IconButton icon="close" title={t('cancel')} onClick={() => (draft.value = null)} />
    </form>
  )
}

const connectCalendar = (go: () => void) =>
  open((close) => (
    <DialogCard actions={<Button autofocus onClick={() => (close(), go())}>{t('googleCalendarGotIt')}</Button>}>{t('googleCalendarHint')}</DialogCard>
  ))

async function disconnectCalendar() {
  if (!(await confirm(t('settings.disconnectConfirm'), t('settings.connected'), true))) return
  setSetting('googleCalendarCredentials', null)
  toast(t('googleCalendarDisableSuccess'))
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

// region Encryption

const ownTodos = () => [...todos.values()].filter((x) => !x.deleted && !x.delegator)

export const openEncryption = () => open((close) => <Encryption close={close} />, true)

function Encryption({ close }: { close: () => void }) {
  rev.value
  const stored = encryptionKey.value
  const on = useSignal(!!stored)
  const password = useSignal(stored ?? '')
  const repeat = useSignal(stored ?? '')
  const show = useSignal(false)
  const changed = on.value ? !!password.value && password.value !== stored : !!stored
  const savable = changed && (!on.value || password.value === repeat.value)
  const own = ownTodos()
  const encrypted = own.filter((x) => x.encrypted).length

  async function save() {
    if (!on.value) {
      if (!(await confirm(t('encryption.disableConfirm'), t('save'), true))) return
      encryptionKey.value = null
      close()
      // Local texts were decrypted; fetch what the server really has
      return hardSync()
    }
    if (!(await confirm(t('encryption.confirm')))) return
    if (!stored) {
      // Without a key, encrypted texts are still ciphertext here; one must decrypt with the new password
      const sample = own.find((x) => x.encrypted && x.text.startsWith('U2FsdGVkX1'))
      if (sample && !(await decrypt(sample.text, password.value))) return toast(t('encryption.errorDecrypting'), true)
      encryptionKey.value = password.value
      close()
      return hardSync()
    }
    encryptionKey.value = password.value
    // A new password: toggling the flag sends each encrypted text again, encrypted with the new key
    for (const x of own.filter((x) => x.encrypted)) update('todo', x.id, { encrypted: false }), update('todo', x.id, { encrypted: true })
    close()
  }

  const pw = (label: string, s: typeof password) => (
    <Input label={t(label)} type={show.value ? 'text' : 'password'} autocomplete="new-password" value={s.value} error={!s.value} onInput={(e) => (s.value = e.currentTarget.value)} />
  )
  return (
    <DialogCard
      title={t('encryption.title')}
      actions={
        <>
          <Button text onClick={close}>{t('close')}</Button>
          {savable && <Button onClick={save}>{t('save')}</Button>}
        </>
      }
    >
      <p>{t('encryption.info')}</p>
      <Switch checked={on.value} onChange={(v) => (on.value = v)} label={t('encryption.switch')} />
      {on.value && (
        <form class="passwords" onSubmit={(e) => (e.preventDefault(), savable && save())}>
          <div class="row">
            <div class="grow">{pw('encryption.password', password)}</div>
            <IconButton icon={show.value ? 'eye_off' : 'eye'} title={show.value ? 'Hide password' : 'Show password'} onClick={() => (show.value = !show.value)} />
          </div>
          {pw('encryption.repeatPassword', repeat)}
          <button type="submit" hidden />
        </form>
      )}
      {stored && on.value && (
        <div class="row wrap">
          <Button small disabled={encrypted === own.length} onClick={() => own.forEach((x) => update('todo', x.id, { encrypted: true }))}>
            {t('encryption.encryptAllButton')} ({own.length - encrypted})
          </Button>
          <Button small disabled={!encrypted} onClick={() => own.forEach((x) => update('todo', x.id, { encrypted: false }))}>
            {t('encryption.decryptAllButton')} ({encrypted})
          </Button>
        </div>
      )}
    </DialogCard>
  )
}

// endregion

// region Hashtags

const PRESETS = {
  light: ['#FFBE3D', '#FF984C', '#FF715B', '#2DCA8C', '#32A4C6', '#377DFF', '#4740D6', '#5603AD'],
  dark: ['#FFBE3D', '#FF984C', '#FF715B', '#6cdaaf', '#32A4C6', '#70bfd7', '#23738b', '#ab81d6'],
}

export const openHashtags = () => open((close) => <Hashtags close={close} />)

function Hashtags({ close }: { close: () => void }) {
  rev.value
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
    if (await confirm(t('deleteAllHashtagsConfirm'), t('deleteAll'), true)) list.forEach((x) => update('tag', x.id, { deleted: true }))
  }
  return (
    <DialogCard
      title={t('hashtags.title')}
      actions={
        <>
          {list.length > 0 && <Button text class="danger" onClick={deleteAll}>{t('deleteAll')}</Button>}
          <span class="grow" />
          <Button autofocus onClick={close}>{t('close')}</Button>
        </>
      }
    >
      {!list.length && <p>{t('emptyHashtags')}</p>}
      {sorted.map((tag) => (
        <TagItem
          key={tag.id}
          tag={tag}
          mode={selected.value?.id === tag.id ? selected.value.mode : undefined}
          select={(mode) => (selected.value = mode ? { id: tag.id, mode } : null)}
          handle={tag.epic ? handle(tag.id) : undefined}
          dragging={order.value !== null && tag.epic}
        />
      ))}
    </DialogCard>
  )
}

function TagItem(p: { tag: Tag; mode?: 'edit' | 'epic'; select: (mode?: 'edit' | 'epic') => void; handle?: JSX.HTMLAttributes<HTMLButtonElement>; dragging: boolean }) {
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
    if (await confirm(t('unEpicConfirm'), t('unEpicInfo'), true)) update('tag', tag.id, { epic: false, epicPoints: 0, epicCompleted: false, epicGoal: 0, epicOrder: 0 })
  }
  return (
    <div class={`tag-item${mode ? ' selected' : ''}${p.dragging ? ' dragging' : ''}`} data-epic={tag.epic ? tag.id : undefined}>
      <div class="row">
        {p.handle && (
          <button type="button" class="icon-btn tag-handle" title="Drag to reorder (or use arrow keys)" aria-label={`Reorder #${tag.tag}`} {...p.handle}>
            <Icon name="drag_indicator" size={20} />
          </button>
        )}
        <b class="grow tag-name" style={{ color: shown }}>#{tag.tag}</b>
        {mode !== 'edit' &&
          (tag.epic ? (
            <IconButton icon="epic" title={t('unEpicInfo')} color="var(--orange)" size={22} onClick={unEpic} />
          ) : (
            <IconButton icon={mode === 'epic' ? 'close' : 'epic'} title={mode === 'epic' ? t('cancel') : t('epic.intoEpic')} size={22} onClick={() => toggle('epic')} />
          ))}
        {mode !== 'epic' && <IconButton icon={mode === 'edit' ? 'close' : 'edit'} title={mode === 'edit' ? t('cancel') : t('edit')} size={22} onClick={() => toggle('edit')} />}
        <IconButton icon="delete" title={t('delete')} color="var(--red)" size={22} onClick={() => update('tag', tag.id, { deleted: true })} />
      </div>
      {tag.epic && (
        <div class="row" style={{ color: shown }}>
          <span>{tag.epicPoints}</span>
          <div class="epic-bar"><i style={{ width: `${Math.min(100, (tag.epicPoints / (tag.epicGoal || 1)) * 100)}%`, background: shown }} /></div>
          <span>{tag.epicGoal}</span>
        </div>
      )}
      {mode === 'edit' && (
        <form class="tag-form" onSubmit={(e) => (e.preventDefault(), saveTag())}>
          <Input label={t('hashtags.name')} value={name.value} autofocus error={!nameOk} onInput={(e) => (name.value = e.currentTarget.value)} />
          {!nameOk && <span class="error">{t('errors.tag.whitespaces')}</span>}
          <div class="row wrap">
            {PRESETS[prefs.value.dark ? 'dark' : 'light'].map((c) => (
              <button key={c} type="button" class={`swatch${color.value === c ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={`Color ${c}`} aria-pressed={color.value === c} onClick={() => (color.value = c)} />
            ))}
            <label class="swatch custom" title="Custom color">
              <input type="color" aria-label="Custom color" value={color.value || '#1e88e5'} onInput={(e) => (color.value = e.currentTarget.value)} />
            </label>
            <span class="grow" />
            <IconButton icon="check" title={t('save')} disabled={!nameOk} onClick={saveTag} />
          </div>
        </form>
      )}
      {mode === 'epic' && (
        <form class="tag-form" onSubmit={(e) => (e.preventDefault(), makeEpic())}>
          <p class="muted">{t('epic.epicForeword')}</p>
          <div class="row">
            <Input class="grow" label={t('epic.epicGoal')} type="number" min={1} step={1} inputMode="numeric" value={goal.value} autofocus error={!!goal.value && !goalOk} onInput={(e) => (goal.value = e.currentTarget.value)} />
            <IconButton icon="check" title={t('epic.intoEpic')} disabled={!goalOk} onClick={makeEpic} />
          </div>
          {!!goal.value && !goalOk && <span class="error">{t(/^\d+$/.test(goal.value) ? 'errors.epic.greaterThanZeroError' : 'errors.epic.numberError')}</span>}
        </form>
      )}
    </div>
  )
}

// endregion
