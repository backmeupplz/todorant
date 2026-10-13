import type { JSX } from 'preact'
import { useRef } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { people, prefs, rev, session, update, type Todo } from '../data/store'
import { t } from '../i18n'
import { isOld, todayTitle } from '../lib/time'
import { hashtags, linkify } from '../lib/text'
import { useSignal } from '../lib/state'
import * as todos from '../logic/todos'
import { IconButton } from './kit'
import { filterByTag } from './router'
import { breakdownTodo, completeTodo, deleteTodo, editTodo } from './actions'

export type CardType = 'current' | 'planning' | 'done' | 'delegatedToMe' | 'delegatedByMe'

const overdue = (todo: Todo, type: CardType) => !todo.completed && type !== 'delegatedByMe' && isOld(todo.monthAndYear, todo.date)

/** "! 🐸 10:00 text with links and #hashtags", like the apps */
export function TodoText({ todo, old }: { todo: Todo; old?: boolean }) {
  rev.value
  if (todos.unreadable(todo))
    return (
      <span class="text encrypted-text">
        🔒 {t('encryption.encryptedTodo')}
        <IconButton icon="info" size={18} title={t('encryption.title')} onClick={() => import('../views/Settings').then((m) => m.openEncryption())} />
      </span>
    )
  return (
    <span class="text">
      {old && <span class="bang">! </span>}
      {todo.frog && '🐸 '}
      {todo.time && <b>{todo.time} </b>}
      {linkify(todo.text).map((p, i) =>
        p.kind === 'link' ? (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">{p.value}</a>
        ) : p.kind === 'hash' ? (
          <span key={i} class="hash" role="link" tabIndex={0} style={{ color: todos.tagColor(p.value.slice(1)) }} onClick={() => filterByTag(p.value.slice(1))}
            onKeyDown={(e) => e.key === 'Enter' && filterByTag(p.value.slice(1))}>
            {p.value}
          </span>
        ) : (
          p.value
        ),
      )}
    </span>
  )
}

/** What can be done with a todo on each screen */
function Actions({ todo, type }: { todo: Todo; type: CardType }) {
  const size = type === 'current' ? 24 : 22
  const old = overdue(todo, type)
  const editable = type !== 'delegatedByMe' || !todo.delegateAccepted
  const delegated = type === 'delegatedToMe' || type === 'delegatedByMe'
  return (
    <div class="actions">
      {editable && type !== 'delegatedToMe' && <IconButton icon="delete" title={t('delete')} color="var(--red)" size={size} onClick={() => deleteTodo(todo)} />}
      {type === 'planning' && !old && todos.titleOf(todo) > todayTitle() && <IconButton icon="moveToToday" title={t('moveUp')} size={size} onClick={() => todos.moveToToday(todo)} />}
      {type === 'current' && todos.isSkippable(todo) && <IconButton icon="skip" title={t('skipped')} size={size} onClick={() => todos.skip(todo)} />}
      {editable && <IconButton icon="edit" title={t('edit')} size={size} onClick={() => editTodo(todo)} />}
      {!delegated && type !== 'done' && <IconButton icon="breakdown" title={t('breakdownInfo')} size={size} onClick={() => breakdownTodo(todo)} />}
      {(type === 'current' || type === 'planning') && <IconButton icon="complete" title={t('completed')} color="var(--green)" size={size} onClick={() => completeTodo(todo)} />}
      {type === 'done' && <IconButton icon="repeat" title={t('completed')} size={size} onClick={() => update('todo', todo.id, { completed: false })} />}
      {type === 'delegatedToMe' && !todo.completed && (
        <button class="btn btn-text btn-small" onClick={() => (todo.monthAndYear ? todos.accept(todo) : editTodo(todo, true))}>{t('accept')}</button>
      )}
    </div>
  )
}

/** A todo as a list row: tap to show its actions (hover shows them on desktop) */
export function TodoCard(p: { todo: Todo; type: CardType; drag?: JSX.HTMLAttributes<HTMLElement>; dragging?: boolean }) {
  const { todo, type } = p
  rev.value
  const expanded = useSignal(false)
  const old = overdue(todo, type)
  const delegated = type === 'delegatedToMe' || type === 'delegatedByMe'
  const color = prefs.value.coloredCards ? todos.tagColor(hashtags(todo.text)[0] ?? '') : undefined
  const from = todo.delegator && todo.delegator !== session.value?.id && !delegated ? people.value.delegators.find((x) => x.id === todo.delegator)?.name : undefined
  const swipe = useSwipe(prefs.value.swipe && type === 'planning', todo)
  const toggle = () => (expanded.value = !expanded.value)
  return (
    <div
      class={`todo-row${old ? ' old' : ''}${expanded.value || delegated ? ' expanded' : ''}${p.dragging ? ' dragging' : ''}`}
      style={color ? { background: `color-mix(in srgb, ${color} 7%, var(--bg))` } : undefined}
      tabIndex={0}
      aria-expanded={expanded.value}
      onClick={(e) => !(e.target as Element).closest('a, button, .hash, .handle, .actions') && toggle()}
      onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
      {...swipe}
    >
      {todo.frogFails > 0 && <div class="bubbles">{Array.from({ length: todo.frogFails }, (_, i) => <i key={i} />)}</div>}
      {from && <div class="from">{t('delegate.from')}: {from}</div>}
      <div>
        {p.drag && todo.frogFails < 3 && <span class="handle" {...p.drag}><Icon name="drag_indicator" size={18} /></span>}
        <TodoText todo={todo} old={old} />
        <Meta todo={todo} />
      </div>
      {delegated && <div class="title">{todos.titleOf(todo) || '—'}</div>}
      <Actions todo={todo} type={type} />
    </div>
  )
}

const Meta = ({ todo }: { todo: Todo }) =>
  todo.encrypted || todo.skipped || todo.repetitive ? (
    <span class="meta" aria-hidden="true">
      {todo.encrypted && !todos.unreadable(todo) && <Icon name="vpn_key" size={14} />}
      {todo.skipped && <Icon name="arrow_forward" size={14} />}
      {todo.repetitive && <Icon name="repeat_plain" size={14} />}
    </span>
  ) : null

/** The todo to do right now, on its own card with every action visible */
export function CurrentCard({ todo }: { todo: Todo }) {
  rev.value
  return (
    <div class={`current-card${overdue(todo, 'current') ? ' old' : ''}`} {...useSwipe(prefs.value.swipe, todo)}>
      {todo.frogFails > 0 && <div class="bubbles">{Array.from({ length: todo.frogFails }, (_, i) => <i key={i} />)}</div>}
      <div class="line">
        <div class="body">
          <TodoText todo={todo} />
          <Meta todo={todo} />
        </div>
        <Actions todo={todo} type="current" />
      </div>
    </div>
  )
}

/** Swipe right completes, swipe left deletes (optional setting) */
function useSwipe(enabled: boolean, todo: Todo): JSX.HTMLAttributes<HTMLDivElement> {
  const start = useRef<{ x: number; y: number } | null>(null)
  if (!enabled) return {}
  const reset = (el: HTMLElement) => (el.style.transform = el.style.background = '')
  return {
    onPointerDown: (e) => (start.current = { x: e.clientX, y: e.clientY }),
    onPointerMove: (e) => {
      if (!start.current) return
      const el = e.currentTarget as HTMLElement
      if (Math.abs(e.clientY - start.current.y) > 30) return (start.current = null), reset(el)
      const dx = e.clientX - start.current.x
      el.style.transform = `translateX(${dx}px)`
      el.style.background = dx > 0 ? 'rgba(75,179,75,.15)' : 'rgba(230,70,70,.15)'
    },
    onPointerUp: (e) => {
      const el = e.currentTarget as HTMLElement
      const dx = start.current ? e.clientX - start.current.x : 0
      start.current = null
      reset(el)
      if (dx > 120) completeTodo(todo)
      else if (dx < -120) deleteTodo(todo)
    },
    onPointerCancel: (e) => ((start.current = null), reset(e.currentTarget as HTMLElement)),
  }
}
