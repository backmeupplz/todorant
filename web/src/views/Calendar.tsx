import { useSignal } from '@preact/signals'
import { settings, type Todo } from '../data/store'
import { language, locale } from '../i18n'
import { addDays, dateString, isOld, parseTitle, todayTitle } from '../lib/time'
import { titleOf } from '../logic/todos'
import { IconButton } from '../ui/kit'
import './Calendar.css'

export type Section = { title: string; todos: Todo[] }
export type Mode = 'rearrange' | 'spread' | null

/** A past day, or a month that has come: not a drop target */
export const isPast = (title: string) => isOld(title.slice(0, 7), title.slice(8) || null)
/** Todos stay on their day or move to a future one; three frog fails pin them */
export const canMove = (todo: Todo, title: string) => title === titleOf(todo) || (todo.frogFails < 3 && !isPast(title))

/** Mouse and touch drag: `move` gets the element under the pointer, `end` runs on release */
export function pointerDrag(e: PointerEvent, move: (el: Element | null, e: PointerEvent) => void, end: () => void) {
  e.preventDefault()
  e.stopPropagation()
  const onMove = (ev: PointerEvent) => {
    if (ev.clientY < 80) scrollBy(0, -12)
    else if (ev.clientY > innerHeight - 80) scrollBy(0, 12)
    move(document.elementFromPoint(ev.clientX, ev.clientY), ev)
  }
  const stop = () => {
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', stop)
    removeEventListener('pointercancel', stop)
    end()
  }
  addEventListener('pointermove', onMove)
  addEventListener('pointerup', stop)
  addEventListener('pointercancel', stop)
}

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

export function Calendar(p: {
  sections: Section[]
  mode: Mode
  /** Tasks picked for spreading, hidden from the grid */
  picked: string[]
  dates: string[]
  onChip: (todo: Todo) => void
  onDay: (title: string) => void
  onMove: (todo: Todo, title: string) => void
}) {
  const now = new Date()
  const month = useSignal(new Date(now.getFullYear(), now.getMonth(), 1))
  const over = useSignal<string | null>(null)
  const dragging = useSignal<string | null>(null)
  const m = month.value
  const first = settings.value.firstDayOfWeek ?? (language.value === 'en' ? 0 : 1)
  const lead = (m.getDay() - first + 7) % 7
  const start = addDays(m, -lead)
  const cells = Math.ceil((lead + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7) * 7
  const byDay = new Map(p.sections.map((s) => [s.title, s.todos.filter((t) => !p.picked.includes(t.id))]))
  const today = todayTitle()
  const show = (d: Date) => (month.value = new Date(d.getFullYear(), d.getMonth(), 1))

  const drag = (e: PointerEvent, todo: Todo) => {
    dragging.value = todo.id
    pointerDrag(
      e,
      (el) => {
        const day = el?.closest<HTMLElement>('[data-day]')?.dataset.day
        over.value = day && canMove(todo, day) ? day : null
      },
      () => {
        if (over.value) p.onMove(todo, over.value)
        over.value = dragging.value = null
      },
    )
  }
  const nudge = (e: KeyboardEvent, todo: Todo, title: string) => {
    if (!(e.key in ARROWS)) return
    e.preventDefault()
    const d = addDays(parseTitle(title), ARROWS[e.key])
    if (!canMove(todo, dateString(d))) return
    p.onMove(todo, dateString(d))
    show(d)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-chip="${todo.id}"]`)?.focus())
  }

  return (
    <div class={`calendar${p.mode ? ` cal-${p.mode}` : ''}`}>
      <div class="cal-head">
        <IconButton icon="chevron_left" title="Previous month" onClick={() => show(new Date(m.getFullYear(), m.getMonth() - 1))} />
        <b aria-live="polite">{m.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</b>
        <IconButton icon="chevron_right" title="Next month" onClick={() => show(new Date(m.getFullYear(), m.getMonth() + 1))} />
      </div>
      <div class="cal-grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} class="cal-weekday">{new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(locale(), { weekday: 'short' })}</div>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const d = addDays(start, i)
          const title = dateString(d)
          const past = title < today
          const pickable = p.mode === 'spread' && !past
          const cls = [
            'cal-day',
            past && 'past',
            title === today && 'today',
            d.getMonth() !== m.getMonth() && 'outside',
            p.dates.includes(title) && 'picked',
            over.value === title && 'over',
          ]
          return (
            <div key={title} data-day={title} class={cls.filter(Boolean).join(' ')} onClick={pickable ? () => p.onDay(title) : undefined}>
              {pickable ? (
                <button type="button" class="cal-num" title={`Spread over ${title}`} aria-pressed={p.dates.includes(title)}>{d.getDate()}</button>
              ) : (
                <span class="cal-num">{d.getDate()}</span>
              )}
              {byDay.get(title)?.map((todo) => (
                <button
                  type="button"
                  key={todo.id}
                  data-chip={todo.id}
                  class={`cal-chip${todo.completed ? ' done' : ''}${dragging.value === todo.id ? ' dragging' : ''}`}
                  title={p.mode === 'rearrange' ? `${todo.text} (drag or use arrow keys to move)` : todo.text}
                  onClick={(e) => (e.stopPropagation(), p.mode !== 'rearrange' && p.onChip(todo))}
                  onPointerDown={p.mode === 'rearrange' ? (e) => drag(e, todo) : undefined}
                  onKeyDown={p.mode === 'rearrange' ? (e) => nudge(e, todo, title) : undefined}
                >
                  {todo.frog && '🐸 '}
                  {todo.text}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
