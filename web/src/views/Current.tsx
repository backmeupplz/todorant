import { rev } from '../data/store'
import { t } from '../i18n'
import { todayTitle } from '../lib/time'
import * as todos from '../logic/todos'
import { HeroButton, IconButton, LargeTitle, Placeholder } from '../ui/kit'
import { CurrentCard } from '../ui/TodoCard'
import { filterByTag } from '../ui/router'

/** One task at a time: today's progress, epics and the todo to do now */
export function Current() {
  rev.value
  const title = todayTitle()
  const incomplete = todos.forDay(title, false)
  const total = incomplete.length + todos.forDay(title, true).length
  const done = total - incomplete.length
  const todo = incomplete[0]
  return (
    <>
      <LargeTitle title={t('current')} info="m.infoCurrent">
        <HeroButton />
      </LargeTitle>
      {todos.epics().map((e) => (
        <div key={e.id} class="epic">
          <button class="epic-name" style={{ color: e.color || 'var(--orange)' }} onClick={() => filterByTag(e.tag)}>#{e.tag}</button>
          <span>{e.epicPoints}</span>
          <div class="epic-bar"><i style={{ width: `${Math.min(100, (e.epicPoints / (e.epicGoal || 1)) * 100)}%`, background: e.color || 'var(--orange)' }} /></div>
          <span>{e.epicGoal}</span>
          {e.epicPoints >= e.epicGoal && e.epicGoal > 0 && <IconButton icon="check" title={t('epic.complete')} color="var(--green)" onClick={() => todos.completeEpic(e)} />}
        </div>
      ))}
      {total > 0 && (
        <div class="progress" aria-label={`${done} / ${total}`}>
          <span>{done}</span>
          {total <= 15 ? (
            <div class="bar">{Array.from({ length: total }, (_, i) => <i key={i} class={i < done ? 'on' : ''} />)}</div>
          ) : (
            <div class="bar linear"><i class="on" style={{ width: `${(done / total) * 100}%` }} /></div>
          )}
          <span>{total}</span>
        </div>
      )}
      {todo ? (
        <CurrentCard key={todo.id} todo={todo} />
      ) : total === 0 ? (
        <Placeholder emoji="🐝" title={t('noTodosTitle')} text={t('noTodosText')} />
      ) : (
        <Placeholder emoji="🎉" title={t('allDoneTitle')} text={t('allDoneText')} />
      )}
    </>
  )
}
