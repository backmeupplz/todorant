import { useSignal } from '../lib/state'
import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { prefs, rev, settings, update, type Todo } from '../data/store'
import { sync, syncing } from '../data/sync'
import { t } from '../i18n'
import { ellipsize } from '../lib/text'
import { isOld, parseTitle } from '../lib/time'
import { allForDay, fixOrder, overdueCount, planning, suggestions, titleOf } from '../logic/todos'
import { addTodo, breakdownTodo, completeTodo, editTodo } from '../ui/actions'
import { dialogOpen, IconButton, Switch } from '../ui/kit'
import { hashTags, setHashTags } from '../ui/router'
import { TodoCard } from '../ui/TodoCard'
import { Calendar, canMove, isPast, pointerDrag, type Mode, type Section } from './Calendar'
import './Planning.css'

const PAGE = 20
const ids = (s: Section) => s.todos.map((t) => t.id).join()

/** Planning or completed sections, overdue first (last when completed, which is newest first) */
const listSections = (completed: boolean, query: string, tags: string[]): Section[] =>
  planning(completed, query, tags).sort((a, b) => (+isPast(b.title) - +isPast(a.title)) * (completed ? -1 : 1))

/** Dated sections for the calendar, with completed todos unless the setting hides them */
function calendarSections(tags: string[]): Section[] {
  const days = new Map<string, Todo[]>()
  for (const completed of settings.value.removeCompletedFromCalendar ? [false] : [false, true])
    for (const s of planning(completed, '', tags)) if (s.title.length === 10) days.set(s.title, [...(days.get(s.title) ?? []), ...s.todos])
  return [...days].map(([title, todos]) => ({ title, todos }))
}

/** Saves a rearranged list (old /rearrange): changed days get order by position; overdue todos moved away fail as frogs */
function apply(list: Section[], before: Map<string, string>) {
  const touched = new Set<string>()
  for (const s of list) {
    if (ids(s) === (before.get(s.title) ?? '')) continue
    touched.add(s.title)
    const shown = new Set(s.todos.map((t) => t.id))
    // Todos the list didn't show (filtered, completed) go after the shown ones, keeping their order
    for (const t of allForDay(s.title)) if (!shown.has(t.id)) update('todo', t.id, { order: s.todos.length + t.order })
    s.todos.forEach((todo, order) => {
      const patch: Partial<Todo> = { order }
      const from = titleOf(todo)
      if (from !== s.title) {
        if (!canMove(todo, s.title)) return
        touched.add(from)
        patch.monthAndYear = s.title.slice(0, 7)
        patch.date = s.title.slice(8) || null
        if (!todo.completed && todo.date && isOld(todo.monthAndYear, todo.date)) {
          patch.frogFails = todo.frogFails + 1
          if (todo.frogFails >= 1) patch.frog = true
        }
      }
      update('todo', todo.id, patch)
    })
  }
  fixOrder(touched)
}

export function Planning() {
  rev.value
  const completed = useSignal(false)
  const calendar = useSignal(false)
  const searching = useSignal(false)
  const input = useSignal('')
  const query = useSignal('')
  const mode = useSignal<Mode>(null)
  const draft = useSignal<Section[]>([])
  const before = useRef(new Map<string, string>())
  const picked = useSignal<string[]>([])
  const dates = useSignal<string[]>([])
  const dragging = useSignal<string | null>(null)
  const collapsed = useSignal(new Set<string>())
  const limit = useSignal(PAGE)
  const first = useRef<Todo>()
  const searchRef = useRef<HTMLInputElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const tags = hashTags()
  const sections = mode.value ? draft.value : calendar.value ? calendarSections(tags) : listSections(completed.value, query.value, tags)
  first.current = !calendar.value && !completed.value && !mode.value ? sections[0]?.todos[0] : undefined

  const start = (m: Mode) => {
    draft.value = sections
    before.current = new Map(sections.map((s) => [s.title, ids(s)]))
    mode.value = m
  }
  const stop = () => {
    mode.value = dragging.value = null
    picked.value = dates.value = []
  }
  const done = () => {
    if (mode.value === 'spread' && dates.value.length) picked.value.forEach((id, i) => place(id, dates.value[i % dates.value.length]))
    apply(draft.value, before.current)
    stop()
  }
  const toggleSearch = () => {
    searching.value = !searching.value
    input.value = query.value = ''
  }

  /** Moves a todo in the draft to `index` (among the other todos) of a day, creating the day when needed */
  function place(id: string, title: string, index = Infinity) {
    const src = draft.value.find((s) => s.todos.some((t) => t.id === id))
    if (!src) return
    const i = src.todos.findIndex((t) => t.id === id)
    if (src.title === title && i === Math.min(index, src.todos.length - 1)) return
    const next = draft.value.map((s) => (s === src ? { ...s, todos: s.todos.filter((t) => t.id !== id) } : s))
    const at = next.findIndex((s) => s.title === title)
    const dst = { title, todos: [...(next[at]?.todos ?? [])] }
    dst.todos.splice(index, 0, src.todos[i])
    if (at < 0) next.push(dst)
    else next[at] = dst
    draft.value = next
  }

  /** Arrow keys on a handle: one step up or down, into the neighbouring allowed day at the edges */
  function nudge(todo: Todo, dir: number) {
    const list = draft.value
    const si = list.findIndex((s) => s.todos.some((t) => t.id === todo.id))
    const j = list[si].todos.findIndex((t) => t.id === todo.id) + dir
    if (j >= 0 && j < list[si].todos.length) place(todo.id, list[si].title, j)
    else
      for (let k = si + dir; k >= 0 && k < list.length; k += dir)
        if (canMove(todo, list[k].title)) {
          place(todo.id, list[k].title, dir < 0 ? Infinity : 0)
          break
        }
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-todo="${todo.id}"] .handle`)?.focus())
  }

  const dragProps = (todo: Todo): JSX.HTMLAttributes<HTMLElement> => ({
    role: 'button',
    tabIndex: 0,
    title: 'Drag or use arrow keys to move',
    'aria-label': `Move ${ellipsize(todo.text, 40)}`,
    onPointerDown: (e) => {
      dragging.value = todo.id
      pointerDrag(
        e,
        (el, ev) => {
          const title = el?.closest<HTMLElement>('[data-section]')?.dataset.section
          if (!el || !title || !canMove(todo, title)) return
          const card = el.closest<HTMLElement>('[data-todo]')
          if (card?.dataset.todo === todo.id) return
          const others = draft.value.find((s) => s.title === title)!.todos.filter((t) => t.id !== todo.id)
          let index = el.closest('.section-header') ? 0 : others.length
          if (card) {
            const r = card.getBoundingClientRect()
            index = others.findIndex((t) => t.id === card.dataset.todo) + (ev.clientY > r.top + r.height / 2 ? 1 : 0)
          }
          place(todo.id, title, index)
        },
        () => (dragging.value = null),
      )
    },
    onKeyDown: (e) => {
      const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (dir) e.preventDefault(), nudge(todo, dir)
    },
  })

  // Search waits for a pause in typing
  useEffect(() => {
    const id = setTimeout(() => ((query.value = input.value), (limit.value = PAGE)), 300)
    return () => clearTimeout(id)
  }, [input.value])

  // More todos as the end of the list scrolls into view; re-observing after each render re-checks it
  useEffect(() => {
    if (!sentinel.current) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (limit.value += PAGE), { rootMargin: '600px' })
    io.observe(sentinel.current)
    return () => io.disconnect()
  })

  // Captured so it runs before the dialogs' Escape handler closes a dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen()) return
      if (e.key === 'Escape' && mode.value) return stop()
      if (!prefs.value.hotkeys) return
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') return e.preventDefault(), toggleSearch()
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return
      const todo = first.current
      if (todo && e.key === 'd') completeTodo(todo)
      else if (todo && e.key === 'b') breakdownTodo(todo)
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [])

  const pickTag = (tag: string) => {
    const m = input.value.match(/#[Ѐ-ӿa-zA-Z_0-9]*$/)
    const head = m ? input.value.slice(0, m.index) : input.value && !input.value.endsWith(' ') ? `${input.value} ` : input.value
    input.value = `${head}#${tag}`
    searchRef.current?.focus()
  }
  const toggle = (title: string) => {
    const next = new Set(collapsed.value)
    next.has(title) ? next.delete(title) : next.add(title)
    collapsed.value = next
  }

  const m = mode.value
  const inDraft = m === 'spread' ? new Map(draft.value.flatMap((s) => s.todos.map((x) => [x.id, x] as const))) : undefined
  let left = limit.value
  const total = sections.reduce((n, s) => n + (collapsed.value.has(s.title) ? 1 : Math.max(1, s.todos.length)), 0)

  return (
    <div class={`planning${dragging.value ? ' dragging' : ''}`}>
      {!completed.value && overdueCount() > 0 && (
        <div class="planning-alert" role="note">
          <Icon name="info" />
          <span>{t('planningText')}</span>
        </div>
      )}
      <div class="toolbar planning-toolbar">
        {!calendar.value && !searching.value && !tags.length && (
          <Switch
            checked={completed.value}
            disabled={!!m}
            label={t('todo.list.completed')}
            onChange={(v) => ((completed.value = v), (limit.value = PAGE))}
          />
        )}
        {searching.value && (
          <div class="planning-search">
            <input
              ref={searchRef}
              autofocus
              type="search"
              class="input"
              placeholder={t('search')}
              aria-label={t('search')}
              value={input.value}
              onInput={(e) => (input.value = e.currentTarget.value)}
            />
            <div class="planning-suggestions">
              {suggestions(input.value, false).map((tag) => (
                <button type="button" key={tag.id} class="btn btn-text btn-small" style={{ color: tag.color || 'var(--link)' }} onClick={() => pickTag(tag.tag)}>
                  #{tag.tag}
                </button>
              ))}
            </div>
          </div>
        )}
        {tags.length > 0 && (
          <div class="planning-tags">
            <IconButton icon="close" size={20} title="Clear tag filter" onClick={() => setHashTags([])} />
            {tags.map((tag) => (
              <span key={tag} class="chip">
                <span>#{tag}</span>
                <IconButton icon="close" size={16} title={`Remove #${tag}`} onClick={() => setHashTags(tags.filter((x) => x !== tag))} />
              </span>
            ))}
          </div>
        )}
        {!searching.value && !tags.length && <span class="grow" />}
        {!m && !completed.value && !searching.value && (
          <IconButton icon="calendar" title="Calendar" onClick={() => ((calendar.value = !calendar.value), (limit.value = PAGE))} />
        )}
        {calendar.value && !m && <IconButton icon="call_split" title={t('spread.hint')} onClick={() => start('spread')} />}
        {!m && !completed.value && <IconButton icon="rearrange" title="Rearrange" onClick={() => start('rearrange')} />}
        {m && (
          <>
            <IconButton icon="close" title={`${t('cancel')} (Esc)`} onClick={stop} />
            <IconButton icon="check" title={t('save')} color="var(--green)" onClick={done} />
          </>
        )}
        {!m && !completed.value && !calendar.value && <IconButton icon="search" title={`${t('search')} (Ctrl+Shift+F)`} onClick={toggleSearch} />}
        <IconButton icon="refresh" title={t('refresh')} disabled={syncing.value} onClick={() => sync()} />
      </div>

      {inDraft && (
        <div class="spread-row">
          <span>{t('spread.spreading')}</span>
          {picked.value.length ? (
            picked.value.map((id) => (
              <span key={id} class="chip">
                <span>{ellipsize(inDraft.get(id)?.text ?? '', 15)}</span>
                <IconButton icon="close" size={16} title="Remove task" onClick={() => (picked.value = picked.value.filter((x) => x !== id))} />
              </span>
            ))
          ) : (
            <span class="chip muted">{t('spread.chooseTasks')}</span>
          )}
          <span>{t('spread.between')}</span>
          {dates.value.length ? (
            dates.value.map((d) => (
              <span key={d} class="chip">
                <span>{d}</span>
                <IconButton icon="close" size={16} title={`Remove ${d}`} onClick={() => (dates.value = dates.value.filter((x) => x !== d))} />
              </span>
            ))
          ) : (
            <span class="chip muted">{t('spread.chooseDates')}</span>
          )}
        </div>
      )}

      {calendar.value ? (
        <Calendar
          sections={sections}
          mode={m}
          picked={picked.value}
          dates={dates.value}
          onChip={(todo) => (m !== 'spread' ? editTodo(todo) : !picked.value.includes(todo.id) && (picked.value = [...picked.value, todo.id]))}
          onDay={(title) => !dates.value.includes(title) && (dates.value = [...dates.value, title])}
          onMove={(todo, title) => place(todo.id, title)}
        />
      ) : (
        sections.map((s) => {
          if (left <= 0) return null
          const open = !collapsed.value.has(s.title)
          const shown = open ? s.todos.slice(0, left) : []
          left -= Math.max(1, shown.length)
          return (
            <section key={s.title} data-section={s.title} class="planning-section">
              <div class="section-header">
                <button type="button" class="section-toggle" aria-expanded={open} onClick={() => toggle(s.title)}>
                  {s.title}
                  {s.title.length > 7 && ` ${t(`weekday${parseTitle(s.title).getDay()}`)}`}
                  {!open && ` (${s.todos.length})`}
                </button>
                {s.title.length > 7 && !m && <IconButton icon="add_plain" size={20} title={t('todo.create.title')} onClick={() => addTodo(s.title)} />}
              </div>
              {shown.map((todo) => (
                <div key={todo.id} data-todo={todo.id}>
                  <TodoCard
                    todo={todo}
                    type={completed.value ? 'done' : 'planning'}
                    drag={m === 'rearrange' ? dragProps(todo) : undefined}
                    dragging={dragging.value === todo.id}
                  />
                </div>
              ))}
            </section>
          )
        })
      )}
      {!calendar.value && total > limit.value && <div ref={sentinel} class="planning-more" />}
    </div>
  )
}
