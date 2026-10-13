import { rev, update } from '../data/store'
import { t } from '../i18n'
import { todayTitle } from '../lib/time'
import * as todos from '../logic/todos'
import { IconButton, Button } from '../ui/kit'
import { TodoCard, showPlanning } from '../ui/TodoCard'
import { setHashTags } from '../ui/router'
import { sync } from '../data/sync'

export function Current() {
  rev.value
  const title = todayTitle()
  const incomplete = todos.forDay(title, false)
  const total = incomplete.length + todos.forDay(title, true).length
  const done = total - incomplete.length
  const todo = incomplete[0]
  return (
    <div>
      {todos.epics().map((e) => (
        <div key={e.id} class="epic">
          <button class="epic-name" style={{ color: e.color || 'var(--orange)' }} onClick={() => (setHashTags([e.tag]), showPlanning())}>
            #{e.tag}
          </button>
          <span>{e.epicPoints}</span>
          <div class="epic-bar"><i style={{ width: `${Math.min(100, (e.epicPoints / (e.epicGoal || 1)) * 100)}%`, background: e.color || 'var(--orange)' }} /></div>
          <span>{e.epicGoal}</span>
          {e.epicPoints >= e.epicGoal && e.epicGoal > 0 && <IconButton icon="check" title={t('epic.complete')} color="var(--green)" onClick={() => todos.completeEpic(e)} />}
        </div>
      ))}
      {total > 0 && (
        <div class="progress">
          <b>{done}</b>
          <div class="bar">
            {total <= 15 ? Array.from({ length: total }, (_, i) => <i key={i} class={i < done ? 'on' : ''} />) : <i class="on" style={{ flex: 'none', width: `${(done / total) * 100}%` }} />}
          </div>
          <b>{total}</b>
          <IconButton icon="refresh" title={t('refresh')} onClick={() => sync()} />
        </div>
      )}
      {todo ? (
        <TodoCard todo={todo} type="current" />
      ) : total === 0 ? (
        <Placeholder emoji="🐝" title={t('noTodosTitle')} text={t('noTodosText')} />
      ) : (
        <Placeholder emoji="🎉" title={t('allDoneTitle')} text={t('allDoneText')} />
      )}
    </div>
  )
}

export const Placeholder = (p: { emoji: string; title: string; text?: string }) => (
  <div class="placeholder">
    <div class="emoji">{p.emoji}</div>
    <h3>{p.title}</h3>
    {p.text && <p class="muted">{p.text}</p>}
  </div>
)

export { update, Button }
