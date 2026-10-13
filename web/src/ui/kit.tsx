import { signal, useSignal } from '@preact/signals'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect } from 'preact/hooks'
import { Icon, type IconName } from '../assets/icons'
import { t } from '../i18n'
import { prefs } from '../data/store'

// region Dialogs

type DialogSpec = { id: number; render: (close: () => void) => ComponentChildren; persistent?: boolean }
const dialogs = signal<DialogSpec[]>([])
let ids = 0

/** Opens a dialog; `render` gets a close function. Returns the close function. */
export function open(render: DialogSpec['render'], persistent = false) {
  const id = ++ids
  const close = () => (dialogs.value = dialogs.value.filter((d) => d.id !== id))
  dialogs.value = [...dialogs.value, { id, render, persistent }]
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
          <div key={d.id} class="scrim" onMouseDown={(e) => e.target === e.currentTarget && !d.persistent && close()}>
            <div class="dialog" role="dialog" aria-modal="true">{d.render(close)}</div>
          </div>
        )
      })}
    </>
  )
}

export function DialogCard(p: { title?: ComponentChildren; children?: ComponentChildren; actions?: ComponentChildren; wide?: boolean }) {
  return (
    <div class={p.wide ? 'card wide' : 'card'}>
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
            <Button autofocus color={danger ? 'danger' : 'primary'} onClick={() => (close(), resolve(true))}>{ok}</Button>
          </>
        }
      />
    )),
  )

export const alert = (title: ComponentChildren, text?: ComponentChildren) =>
  new Promise<void>((resolve) =>
    open((close) => <DialogCard title={title} actions={<Button autofocus onClick={() => (close(), resolve())}>OK</Button>}>{text}</DialogCard>),
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

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & { disabled?: boolean; autofocus?: boolean; color?: 'primary' | 'danger' | 'success' | 'gradient'; text?: boolean; small?: boolean }
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

export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; disabled?: boolean }) {
  return (
    <label class="switch">
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

export const Spinner = () => <span class="spinner" aria-label="Loading" />

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
