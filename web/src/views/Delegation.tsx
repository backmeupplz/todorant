import { useSignal } from '../lib/state'
import { people, rev, type Todo } from '../data/store'
import { t } from '../i18n'
import { delegated } from '../logic/todos'
import { IconButton, Placeholder, Segmented, TopBar } from '../ui/kit'
import { go } from '../ui/router'
import { TodoCard } from '../ui/TodoCard'

/** Delegated tasks like the app: Inbox (to me), By me, and Completed (by me), grouped by person */
export function Delegation() {
  rev.value
  const section = useSignal(0)
  const byMe = section.value > 0
  const others = byMe ? people.value.delegates : people.value.delegators
  const groups = new Map<string, Todo[]>()
  for (const todo of delegated(byMe, section.value === 2)) {
    const name = others.find((p) => p.id === (byMe ? todo.user : todo.delegator))?.name
    if (name) groups.set(name, [...(groups.get(name) ?? []), todo])
  }
  return (
    <>
      <TopBar actions={<IconButton icon="supervisor_account" title={t('m.delegate.delegates')} onClick={() => go(byMe ? '/settings/delegates' : '/settings/delegators')} />}>
        <Segmented
          label={t('delegate.title')}
          options={[t('m.delegate.ToMe'), t('m.delegate.ByMe'), t('m.completed')]}
          selected={section.value}
          onSelect={(i) => (section.value = i)}
        />
      </TopBar>
      {!groups.size ? (
        <Placeholder emoji="🏅" text={t(section.value === 0 ? (others.length ? 'm.delegate.noDelegatedTasks' : 'm.delegate.noDelegators') : others.length ? 'm.delegate.noDelegatedTasksTo' : 'm.delegate.noDelegates')} />
      ) : (
        [...groups].map(([name, list]) => (
          <section key={name}>
            <div class="day">{name}</div>
            {list.map((todo) => <TodoCard key={todo.id} todo={todo} type={byMe ? 'delegatedByMe' : 'delegatedToMe'} />)}
          </section>
        ))
      )}
    </>
  )
}
