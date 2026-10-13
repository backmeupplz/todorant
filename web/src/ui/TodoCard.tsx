import type { JSX } from 'preact'
import { useRef } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { prefs, rev, session, settings, update, people, type Todo } from '../data/store'
import { t } from '../i18n'
import { isOld, todayTitle } from '../lib/time'
import { hashtags, linkify } from '../lib/text'
import * as todos from '../logic/todos'
import { IconButton } from './kit'
import { hashTags, setHashTags } from './router'
import { completeTodo, deleteTodo, editTodo, breakdownTodo } from './actions'

export type CardType = 'current' | 'planning' | 'done' | 'delegatedToMe' | 'delegatedByMe'

/** Planning's tab switcher; set by the shell */
export let showPlanning = () => {}
export const setShowPlanning = (f: () => void) => (showPlanning = f)

export function TodoText({ todo }: { todo: Todo }) {
  rev.value
  return (
    <span class="text">
      {todo.frog && '🐸 '}
      {todo.time && <b>{todo.time} </b>}
      {linkify(todo.text).map((p, i) =>
        p.kind === 'link' ? (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{p.value}</a>
        ) : p.kind === 'hash' ? (
          <span
            key={i}
            class="hash"
            style={{ color: todos.tagColor(p.value.slice(1)) }}
            onClick={(e) => {
              e.stopPropagation()
              const name = p.value.slice(1)
              if (!hashTags().includes(name)) setHashTags([...hashTags(), name])
              showPlanning()
            }}
          >
            {p.value}
          </span>
        ) : (
          p.value
        ),
      )}
    </span>
  )
}

export function TodoCard(p: { todo: Todo; type: CardType; drag?: JSX.HTMLAttributes<HTMLElement>; dragging?: boolean }) {
  const { todo, type } = p
  rev.value
  const old = !todo.completed && isOld(todo.monthAndYear, todo.date) && type !== 'delegatedByMe'
  const small = type === 'planning' || type === 'done'
  const size = small ? 20 : 24
  const color = prefs.value.coloredCards ? todos.tagColor(hashtags(todo.text)[0] ?? '') : undefined
  const delegatorName = todo.delegator && todo.delegator !== session.value?.id ? people.value.delegators.find((x) => x.id === todo.delegator)?.name : undefined
  const futureInPlanning = type === 'planning' && !old && todos.titleOf(todo) > todayTitle()
  const editable = type !== 'delegatedByMe' || !todo.delegateAccepted
  const swipe = useSwipe(prefs.value.swipe && (type === 'current' || type === 'planning'), todo)
  return (
    <div
      class={`todo${old ? ' old' : ''}${p.dragging ? ' dragging' : ''}`}
      style={color ? { background: `color-mix(in srgb, ${color} 5%, var(--surface))` } : undefined}
      {...swipe}
    >
      {todo.frogFails > 0 && <div class="bubbles">{Array.from({ length: todo.frogFails }, (_, i) => <i key={i} />)}</div>}
      {delegatorName && type !== 'delegatedToMe' && <div class="muted">{t('delegate.from')}: {delegatorName}</div>}
      <div>
        {p.drag && todo.frogFails < 3 && <span class="handle" {...p.drag}><Icon name="drag_indicator" size={18} /></span>}
        <TodoText todo={todo} />
      </div>
      <div class="meta">
        {old && <Icon name="error_outline" size={18} />}
        {todo.encrypted && <Icon name="vpn_key" size={16} />}
        {todo.skipped && <Icon name="arrow_forward" size={16} />}
        {todo.repetitive && <Icon name="repeat_plain" size={16} />}
        <span class="grow">{type === 'delegatedByMe' || type === 'delegatedToMe' ? todos.titleOf(todo) : ''}</span>
        {editable && type !== 'delegatedToMe' && <IconButton icon="delete" title={t('delete')} color="var(--red)" size={size} onClick={() => deleteTodo(todo)} />}
        {futureInPlanning && <IconButton icon="moveToToday" title={t('moveUp')} size={size} onClick={() => todos.moveToToday(todo)} />}
        {type === 'current' && todos.isSkippable(todo) && <IconButton icon="skip" title={t('skipped')} size={size} onClick={() => todos.skip(todo)} />}
        {type !== 'done' && !type.startsWith('delegated') && <IconButton icon="breakdown" title={t('breakdownInfo')} size={size} onClick={() => breakdownTodo(todo)} />}
        {editable && <IconButton icon="edit" title={t('edit')} size={size} onClick={() => editTodo(todo)} />}
        {(type === 'current' || type === 'planning') && <IconButton icon="complete" title={t('completed')} color="var(--green)" size={size} onClick={() => completeTodo(todo)} />}
        {type === 'done' && <IconButton icon="repeat" title={t('completed')} size={size} onClick={() => update('todo', todo.id, { completed: false })} />}
        {type === 'delegatedToMe' && !todo.completed && (
          <button class="btn btn-text" onClick={() => (todo.monthAndYear ? todos.accept(todo) : editTodo(todo, true))}>{t('accept')}</button>
        )}
      </div>
    </div>
  )
}

/** Swipe right completes, swipe left deletes (optional setting) */
function useSwipe(enabled: boolean, todo: Todo): JSX.HTMLAttributes<HTMLDivElement> {
  const start = useRef<{ x: number; y: number } | null>(null)
  if (!enabled) return {}
  return {
    onPointerDown: (e) => (start.current = { x: e.clientX, y: e.clientY }),
    onPointerMove: (e) => {
      if (!start.current) return
      const dx = e.clientX - start.current.x
      if (Math.abs(e.clientY - start.current.y) > 30) return (start.current = null), ((e.currentTarget as HTMLElement).style.transform = '')
      const el = e.currentTarget as HTMLElement
      el.style.transform = `translateX(${dx}px)`
      el.style.background = dx > 0 ? 'rgba(75,179,75,.1)' : 'rgba(230,70,70,.1)'
    },
    onPointerUp: (e) => {
      const el = e.currentTarget as HTMLElement
      const dx = start.current ? e.clientX - start.current.x : 0
      start.current = null
      el.style.transform = el.style.background = ''
      if (dx > 120) completeTodo(todo)
      else if (dx < -120) deleteTodo(todo)
    },
    onPointerCancel: (e) => ((start.current = null), ((e.currentTarget as HTMLElement).style.transform = '')),
  }
}

export { settings }
