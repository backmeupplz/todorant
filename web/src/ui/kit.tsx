import { signal, useSignal } from '../lib/state'
import type { ComponentChildren, ComponentType, JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { Icon, type IconName } from '../assets/icons'
import { t } from '../i18n'
import { hero, prefs } from '../data/store'
import { rank, shortNumber } from '../logic/hero'
import { go } from './router'

// region Dialogs

type DialogSpec = { id: number; render: (close: () => void) => ComponentChildren; persistent?: boolean; sheet?: boolean }
const dialogs = signal<DialogSpec[]>([])
let ids = 0

/** Opens a dialog; `render` gets a close function. Returns the close function. A `sheet` is full screen on phones. */
export function open(render: DialogSpec['render'], persistent = false, sheet = false) {
  const id = ++ids
  const close = () => (dialogs.value = dialogs.value.filter((d) => d.id !== id))
  dialogs.value = [...dialogs.value, { id, render, persistent, sheet }]
  return close
}
export const dialogOpen = () => dialogs.value.length > 0
export const closeDialogs = () => (dialogs.value = [])

export function Dialogs() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const top = dialogs.value.at(-1)
      if (e.key === 'Escape' && top) dialogs.value = dialogs.value.slice(0, -1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      {dialogs.value.map((d) => {
        const close = () => (dialogs.value = dialogs.value.filter((x) => x.id !== d.id))
        return (
          <div key={d.id} class={d.sheet ? 'scrim sheet-scrim' : 'scrim'} onMouseDown={(e) => e.target === e.currentTarget && !d.persistent && close()}>
            <div class={d.sheet ? 'dialog sheet' : 'dialog'} role="dialog" aria-modal="true">{d.render(close)}</div>
          </div>
        )
      })}
    </>
  )
}

export function DialogCard(p: { title?: ComponentChildren; children?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="card">
      {p.title && <h2 class="dialog-title">{p.title}</h2>}
      {p.children && <div class="dialog-text">{p.children}</div>}
      {p.actions && <div class="dialog-actions">{p.actions}</div>}
    </div>
  )
}

/** A yes/no question; resolves true on confirm */
export const confirm = (text: ComponentChildren, ok = t('save'), danger = false) =>
  new Promise<boolean>((resolve) =>
    open((close) => (
      <DialogCard
        title={text}
        actions={
          <>
            <Button text onClick={() => (close(), resolve(false))}>{t('cancel')}</Button>
            <Button text autofocus class={danger ? 'strong danger' : 'strong'} onClick={() => (close(), resolve(true))}>{ok}</Button>
          </>
        }
      />
    )),
  )

export const alert = (title: ComponentChildren, text?: ComponentChildren) =>
  new Promise<void>((resolve) =>
    open((close) => <DialogCard title={title} actions={<Button text autofocus class="strong" onClick={() => (close(), resolve())}>OK</Button>}>{text}</DialogCard>),
  )

// endregion

// region Snackbar

export const snack = signal<{ text: string; error?: boolean; action?: [string, () => void] } | null>(null)
let snackTimer: ReturnType<typeof setTimeout> | undefined
export function toast(text: string, error = false) {
  snack.value = { text, error }
  clearTimeout(snackTimer)
  snackTimer = setTimeout(() => (snack.value = null), 4000)
}
export const showError = (e: unknown) => toast(e instanceof Error ? e.message : t(String(e)), true)
export function Snackbar() {
  const s = snack.value
  return s ? (
    <div class={s.error ? 'snackbar error' : 'snackbar'} role="status">
      <span>{s.text}</span>
      {s.action && <Button text onClick={s.action[1]}>{s.action[0]}</Button>}
    </div>
  ) : null
}

// endregion

// region Controls

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & { type?: 'button' | 'submit'; disabled?: boolean; autofocus?: boolean; color?: 'primary' | 'danger' | 'success' | 'gradient' | 'orange'; text?: boolean; small?: boolean }
export function Button({ color = 'primary', text, small, class: cls, ...rest }: ButtonProps) {
  return <button type="button" class={`btn ${text ? 'btn-text' : `btn-${color}`}${small ? ' btn-small' : ''} ${cls ?? ''}`} {...rest} />
}

export function IconButton(p: { icon: IconName; title?: string; onClick?: (e: MouseEvent) => void; color?: string; size?: number; disabled?: boolean; class?: string }) {
  return (
    <button type="button" class={`icon-btn ${p.class ?? ''}`} title={p.title} aria-label={p.title} onClick={p.onClick} disabled={p.disabled} style={{ color: p.color }}>
      <Icon name={p.icon} size={p.size ?? 24} />
    </button>
  )
}

export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; disabled?: boolean; row?: boolean }) {
  return (
    <label class={p.row ? 'switch table-row' : 'switch'}>
      <span>{p.label}</span>
      <input type="checkbox" role="switch" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onChange(e.currentTarget.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

export function Field(p: JSX.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: boolean }) {
  const { label, error, class: cls, ...rest } = p
  return (
    <label class={`field ${error ? 'invalid' : ''} ${cls ?? ''}`}>
      {label && <span>{label}</span>}
      <input {...rest} />
    </label>
  )
}

/** A dropdown menu anchored to its trigger */
export function Menu(p: { trigger: (toggle: () => void) => ComponentChildren; children: (close: () => void) => ComponentChildren }) {
  const state = useSignal(false)
  const isOpen = state.value
  const close = () => (state.value = false)
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => !(e.target as Element).closest('.menu') && close()
    setTimeout(() => addEventListener('mousedown', onDown))
    return () => removeEventListener('mousedown', onDown)
  }, [isOpen])
  return (
    <div class="menu-anchor">
      {p.trigger(() => (state.value = !isOpen))}
      {isOpen && <div class="menu" role="menu">{p.children(close)}</div>}
    </div>
  )
}

// Loading states are skeletons shaped like what's coming, never spinners
const WIDTHS = [72, 54, 86, 40, 64, 78, 50, 92]
/** A screen that's loading: an optional large title and list rows */
export const Skeleton = ({ lines = 6, title = true }: { lines?: number; title?: boolean }) => (
  <div class="skeleton" aria-busy="true" aria-label="Loading">
    {title && <i class="sk-title" />}
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} class="sk-row"><i style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} /></div>
    ))}
  </div>
)
/** A block of a given size (a QR code, a chart) */
export const SkeletonBlock = ({ width, height }: { width: number | string; height: number | string }) => (
  <i class="sk-block" style={{ width, height }} aria-busy="true" aria-label="Loading" />
)
/** Inline loading value (rows, buttons) */
export const Spinner = () => <i class="sk-inline" aria-busy="true" aria-label="Loading" />

/** A component loaded on first render (code splitting); shows its skeleton meanwhile. `preload()` loads it
 * ahead, so a render after it resolves draws the component right away (no skeleton) */
export function lazy<P>(load: () => Promise<ComponentType<P>>, Fallback: () => JSX.Element = () => <Skeleton />) {
  let loaded: ComponentType<P> | undefined
  let loading: Promise<unknown> | undefined
  const preload = () => (loading ??= load().then((c) => (loaded = c)))
  const Lazy = (props: P & JSX.IntrinsicAttributes) => {
    const [, setReady] = useState(false)
    if (loaded) {
      const C = loaded as ComponentType<any>
      return <C {...props} />
    }
    preload().then(() => setReady(true))
    return <Fallback />
  }
  return Object.assign(Lazy, { preload })
}

// endregion

// region Sounds and confetti

const audio: Record<string, HTMLAudioElement> = {}
export function play(name: 'level_up' | 'nice' | 'task_done') {
  if (!prefs.value.sound) return
  const a = (audio[name] ??= new Audio(`/audio/${name}.mp3`))
  a.volume = 0.3
  a.currentTime = 0
  a.play().catch(() => {})
}
export const playComplete = (frog: boolean) => play(frog ? (Math.random() < 0.1 ? 'nice' : 'level_up') : 'task_done')

let lastConfetti = 0
/** Confetti burst, hearts one time in five; at most every 15 s */
export function confetti() {
  if (Date.now() - lastConfetti < 15_000 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  lastConfetti = Date.now()
  const hearts = Math.random() < 0.2
  const canvas = document.createElement('canvas')
  canvas.className = 'confetti'
  canvas.width = innerWidth
  canvas.height = innerHeight
  document.body.append(canvas)
  const ctx = canvas.getContext('2d')!
  const colors = ['#ff641a', '#3366ff', '#4BB34B', '#ffd166', '#E64646']
  const bits = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.5, vx: Math.random() * 4 - 2, vy: 2 + Math.random() * 4,
    r: Math.random() * Math.PI, c: colors[(Math.random() * colors.length) | 0],
  }))
  const end = performance.now() + 3000
  const frame = (now: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const b of bits) {
      b.x += b.vx
      b.y += b.vy
      b.r += 0.1
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(b.r)
      ctx.fillStyle = b.c
      if (hearts) (ctx.font = '16px serif'), ctx.fillText('❤️', 0, 0)
      else ctx.fillRect(-4, -2, 8, 4)
      ctx.restore()
    }
    if (now < end) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}

// endregion

// region Screen building blocks (the mobile app's look)

/** A centered-title bar: optional back/close on the left, actions on the right */
export function TopBar(p: { title?: ComponentChildren; onBack?: () => void; back?: 'back' | 'close'; left?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      <div class="side">
        {p.onBack ? <IconButton icon={p.back === 'close' ? 'close' : 'chevron_left'} title={t(p.back === 'close' ? 'close' : 'back')} onClick={p.onBack} /> : p.left}
      </div>
      {p.children ?? <h2>{p.title}</h2>}
      <div class="side" style={{ justifyContent: 'flex-end' }}>{p.actions}</div>
    </header>
  )
}

/** The big bold screen title with an info button (an i18n key) and, optionally, the hero points */
export function LargeTitle(p: { title: string; info?: string; children?: ComponentChildren }) {
  return (
    <header class="large-title">
      <h1>{p.title}</h1>
      {p.info && <InfoButton text={p.info} />}
      {p.children}
    </header>
  )
}

/** Explains a screen, like the apps' (i) buttons; offers support */
export const showInfo = (key: string) =>
  open((close) => (
    <DialogCard
      title={t('m.infoTitle')}
      actions={
        <>
          <Button text onClick={() => (close(), showSupport())}>{t('m.supportLabel')}</Button>
          <Button text autofocus class="strong" onClick={close}>OK</Button>
        </>
      }
    >
      {t(key)}
    </DialogCard>
  ))
export const InfoButton = ({ text }: { text: string }) => <IconButton icon="info" class="info-btn" title={t('m.infoTitle')} onClick={() => showInfo(text)} />

export const showSupport = () =>
  open((close) => (
    <DialogCard title={t('m.supportLabel')} actions={<Button text autofocus class="strong" onClick={close}>OK</Button>}>
      <p>{t('m.supportText')}</p>
      <div class="dialog-links">
        <a class="table-row" href="mailto:n@borodutch.com"><span class="label">Email</span><span class="value">n@borodutch.com</span><Icon name="chevron_right" size={20} class="chevron" /></a>
        <a class="table-row" href="https://t.me/borodutch" target="_blank" rel="noopener noreferrer"><span class="label">Telegram</span><span class="value">@borodutch</span><Icon name="chevron_right" size={20} class="chevron" /></a>
      </div>
    </DialogCard>
  ))

/** Hero points with progress to the next rank; opens the hero page */
export function HeroButton() {
  if (!prefs.value.gamification) return null
  const { progress } = rank()
  return (
    <button type="button" class="hero-btn" title={t('heroProfileTitle')} onClick={() => go('/settings/hero')} style={{ color: 'var(--orange)', '--track': 'var(--orange-soft)' }}>
      {shortNumber(hero.value)}
      <i><b style={{ width: `${Math.round(progress * 100)}%` }} /></i>
    </button>
  )
}

export function Segmented(p: { options: string[]; selected: number; onSelect: (i: number) => void; label?: string; disabled?: boolean }) {
  const n = p.options.length
  return (
    <div class={p.disabled ? 'segmented animated disabled' : 'segmented animated'} role="group" aria-label={p.label}>
      <span class="thumb" aria-hidden="true" style={{ width: `calc((100% - 4px - ${(n - 1) * 2}px) / ${n})`, transform: `translateX(calc(${p.selected * 100}% + ${p.selected * 2}px))` }} />
      {p.options.map((o, i) => (
        <button key={o} type="button" aria-pressed={i === p.selected} disabled={p.disabled} onClick={() => p.onSelect(i)}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** A settings-style row: label, optional value and a chevron when it does something */
export function TableRow(p: { label: ComponentChildren; value?: ComponentChildren; onClick?: () => void; href?: string; danger?: boolean; children?: ComponentChildren }) {
  const body = (
    <>
      <span class="label">{p.label}</span>
      {p.value !== undefined && <span class="value">{p.value}</span>}
      {p.children}
      {(p.onClick || p.href) && <Icon name="chevron_right" size={20} class="chevron" />}
    </>
  )
  const cls = p.danger ? 'table-row danger' : 'table-row'
  if (p.href) return <a class={cls} href={p.href} target="_blank" rel="noopener noreferrer">{body}</a>
  if (p.onClick) return <button type="button" class={cls} onClick={p.onClick}>{body}</button>
  return <div class={cls}>{body}</div>
}

export const Caption = ({ children }: { children: ComponentChildren }) => <div class="caption">{children}</div>
export const SectionDivider = () => <div class="section-divider" />

export const Placeholder = (p: { emoji: string; title?: string; text?: string }) => (
  <div class="placeholder">
    <div class="emoji">{p.emoji}</div>
    {p.title && <h3>{p.title}</h3>}
    {p.text && <p>{p.text}</p>}
  </div>
)

/** A full-screen form on phones, a centered card on desktop: top bar, scrolling body, sticky footer */
export function Sheet(p: { title: ComponentChildren; onClose: () => void; actions?: ComponentChildren; footer?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="card sheet-card">
      <TopBar title={p.title} onBack={p.onClose} back="close" actions={p.actions} />
      <div class="sheet-body">{p.children}</div>
      {p.footer && <div class="sheet-footer">{p.footer}</div>}
    </div>
  )
}

// endregion
