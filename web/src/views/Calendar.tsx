import { settings, type Todo } from '../data/store'
import { language, locale, t } from '../i18n'
import { useSignal } from '../lib/state'
import { capitalize, ellipsize } from '../lib/text'
import { addDays, dateString, isOld, parseTitle, todayTitle } from '../lib/time'
import { titleOf } from '../logic/todos'
import { addTodo, editTodo } from '../ui/actions'
import { IconButton } from '../ui/kit'
import { TodoCard } from '../ui/TodoCard'
import './Calendar.css'

export type Section = { title: string; todos: Todo[] }
export type Mode = 'rearrange' | 'spread' | null

/** A past day, or a month that has come: not a drop target */
export const isPast = (title: string) => isOld(title.slice(0, 7), title.slice(8) || null)
/** Todos stay on their day or move to a future one; three frog fails pin them */
export const canMove = (todo: Todo, title: string) => title === titleOf(todo) || (todo.frogFails < 3 && !isPast(title))
/** "2026-10-13, Tuesday" like the app's day headers; months stay "2026-10" */
export const dayLabel = (title: string) => (title.length === 10 ? `${title}, ${t(`weekday${parseTitle(title).getDay()}`)}` : title)

/**
 * Mouse and touch drag: `move` gets the element under the pointer, also while the page scrolls itself
 * with the pointer held near the top or bottom edge; `end` runs on release.
 */
export function pointerDrag(e: PointerEvent, move: (el: Element | null, e: PointerEvent) => void, end: () => void) {
  e.preventDefault()
  e.stopPropagation()
  let last = e
  const at = (ev: PointerEvent) => move(document.elementFromPoint(ev.clientX, ev.clientY), ev)
  const onMove = (ev: PointerEvent) => at((last = ev))
  let frame = requestAnimationFrame(function scroll() {
    // Only once the pointer has really moved, so grabbing a row near the edge doesn't scroll
    const dy = Math.abs(last.clientY - e.clientY) < 10 ? 0 : last.clientY < 90 ? -12 : last.clientY > innerHeight - 90 ? 12 : 0
    if (dy) scrollBy(0, dy), at(last)
    frame = requestAnimationFrame(scroll)
  })
  const stop = () => {
    cancelAnimationFrame(frame)
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

/** Chips shown per day; busier days show "+N" and list everything below the grid */
const CHIPS = 3

/** A month of dated todos (dots on phones, chips on wider screens) with the tapped day's todos listed below */
export function Calendar(p: {
  sections: Section[]
  mode: Mode
  /** Tasks picked for spreading, hidden here */
  picked: string[]
  /** Days to spread over */
  dates: string[]
  onPick: (todo: Todo) => void
  onDate: (title: string) => void
  onMove: (todo: Todo, title: string) => void
  /** Starts spreading tasks over days (shown in the month header, where it applies) */
  onSpread?: () => void
}) {
  const today = todayTitle()
  const month = useSignal(parseTitle(today.slice(0, 7)))
  const selected = useSignal(today)
  const over = useSignal<string | null>(null)
  const dragging = useSignal<string | null>(null)
  const m = month.value
  const day = selected.value
  const first = settings.value.firstDayOfWeek ?? (language.value === 'en' ? 0 : 1)
  const lead = (m.getDay() - first + 7) % 7
  const start = addDays(m, -lead)
  const cells = Math.ceil((lead + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7) * 7
  const byDay = new Map(p.sections.map((s) => [s.title, s.todos.filter((t) => !p.picked.includes(t.id))]))
  const rearrange = p.mode === 'rearrange'
  const show = (d: Date) => (month.value = new Date(d.getFullYear(), d.getMonth(), 1))

  const drag = (e: PointerEvent, todo: Todo, from: string) => {
    dragging.value = todo.id
    pointerDrag(
      e,
      (el) => {
        const title = el?.closest<HTMLElement>('[data-day]')?.dataset.day
        over.value = title && title !== from && canMove(todo, title) ? title : null
      },
      () => {
        if (over.value) p.onMove(todo, over.value)
        over.value = dragging.value = null
      },
    )
  }
  /** Arrow keys move a todo by a day or a week; the selected day follows it and it keeps focus */
  const nudge = (e: KeyboardEvent, todo: Todo, from: string, focus: string) => {
    if (!(e.key in ARROWS)) return
    e.preventDefault()
    const d = addDays(parseTitle(from), ARROWS[e.key])
    const to = dateString(d)
    if (!canMove(todo, to)) return
    p.onMove(todo, to)
    selected.value = to
    show(d)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(focus)?.focus())
  }

  return (
    <div class={`calendar${p.mode ? ` cal-${p.mode}` : ''}`}>
      <div class="cal-head">
        <IconButton icon="chevron_left" title="Previous month" onClick={() => show(new Date(m.getFullYear(), m.getMonth() - 1))} />
        <b aria-live="polite">{capitalize(m.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }))}</b>
        <IconButton icon="chevron_right" title="Next month" onClick={() => show(new Date(m.getFullYear(), m.getMonth() + 1))} />
        {p.onSpread && <IconButton icon="call_split" class="cal-spread" title={t('spread.hint')} onClick={p.onSpread} />}
      </div>
      <div class="cal-grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} class="cal-weekday">{new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(locale(), { weekday: 'short' })}</div>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const d = addDays(start, i)
          const title = dateString(d)
          const todos = byDay.get(title) ?? []
          const cls = [
            'cal-day',
            title < today && 'past',
            title === today && 'today',
            title === day && 'selected',
            d.getMonth() !== m.getMonth() && 'outside',
            p.dates.includes(title) && 'picked',
            over.value === title && 'over',
          ]
          return (
            <div key={title} data-day={title} class={cls.filter(Boolean).join(' ')}>
              {/* Stretched over the whole cell: selects the day, and picks it to spread over */}
              <button
                type="button"
                class="cal-num"
                aria-label={todos.length ? `${dayLabel(title)} (${todos.length})` : dayLabel(title)}
                aria-pressed={p.mode === 'spread' ? p.dates.includes(title) : title === day}
                onClick={() => ((selected.value = title), p.mode === 'spread' && title >= today && p.onDate(title))}
              >
                {d.getDate()}
              </button>
              {todos.length > 0 && (
                <div class="cal-chips">
                  {todos.slice(0, CHIPS).map((todo) => (
                    <button
                      type="button"
                      key={todo.id}
                      data-chip={todo.id}
                      class={`cal-chip${todo.completed ? ' done' : ''}${dragging.value === todo.id ? ' dragging' : ''}`}
                      title={rearrange ? `${todo.text} (drag or use arrow keys to move)` : todo.text}
                      onClick={() => (p.mode === 'spread' ? p.onPick(todo) : !p.mode && editTodo(todo))}
                      onPointerDown={rearrange ? (e) => drag(e, todo, title) : undefined}
                      onKeyDown={rearrange ? (e) => nudge(e, todo, title, `[data-chip="${todo.id}"]`) : undefined}
                    >
                      {todo.frog && '🐸 '}
                      {todo.text}
                    </button>
                  ))}
                  {/* The rest is in the day's list below the grid (also where they can be picked or dragged) */}
                  {todos.length > CHIPS && (
                    <button type="button" class="cal-more" onClick={() => (selected.value = title)}>+{todos.length - CHIPS}</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <section class="cal-list" aria-label={dayLabel(day)}>
        <div class="day">
          <span>{dayLabel(day)}</span>
          {!p.mode && !isPast(day) && <IconButton icon="add" size={20} title={t('todo.create.title')} onClick={() => addTodo(day)} />}
        </div>
        {(byDay.get(day) ?? []).map((todo) =>
          p.mode === 'spread' ? (
            <button key={todo.id} type="button" class="cal-pick" onClick={() => p.onPick(todo)}>
              {todo.frog && '🐸 '}
              {todo.text}
            </button>
          ) : (
            <div key={todo.id} data-todo={todo.id}>
              <TodoCard
                todo={todo}
                type={todo.completed ? 'done' : 'planning'}
                dragging={dragging.value === todo.id}
                drag={
                  rearrange
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        title: 'Drag to a day or use arrow keys to move',
                        'aria-label': `Move ${ellipsize(todo.text, 40)}`,
                        onPointerDown: (e) => drag(e, todo, day),
                        onKeyDown: (e) => nudge(e, todo, day, `[data-todo="${todo.id}"] .handle`),
                      }
                    : undefined
                }
              />
            </div>
          ),
        )}
      </section>
    </div>
  )
}
