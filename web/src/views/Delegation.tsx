import { useSignal } from '@preact/signals'
import { call } from '../data/rest'
import { people, rev, session, todos, update, type Person, type Todo } from '../data/store'
import { sync } from '../data/sync'
import { t } from '../i18n'
import { delegated } from '../logic/todos'
import { Button, confirm, DialogCard, IconButton, open, showError, Switch, toast } from '../ui/kit'
import { TodoCard } from '../ui/TodoCard'
import { Placeholder } from './Current'
import './dialogs.css'
import './Delegation.css'

/** Delegated tasks grouped by the other person: to me (to accept, or completed) or by me */
export function Delegation() {
  rev.value
  const byMe = useSignal(false)
  const completed = useSignal(false)
  const others = byMe.value ? people.value.delegates : people.value.delegators
  const groups = new Map<string, Todo[]>()
  for (const todo of delegated(byMe.value, completed.value)) {
    const name = others.find((p) => p.id === (byMe.value ? todo.user : todo.delegator))?.name
    if (name) groups.set(name, [...(groups.get(name) ?? []), todo])
  }
  return (
    <div>
      <div class="toolbar delegation-bar">
        <div class="grow">
          <Switch checked={byMe.value} onChange={(v) => (byMe.value = v)} label={t('todo.list.delegated')} />
          <Switch checked={completed.value} onChange={(v) => (completed.value = v)} label={t('todo.list.completed')} />
        </div>
        <IconButton icon="supervisor_account" title={t('delegate.title')} onClick={openDelegationSettings} />
        <IconButton icon="refresh" title={t('refresh')} onClick={() => sync()} />
      </div>
      {!others.length ? (
        <Placeholder emoji="👁👄👁" title={t(byMe.value ? 'delegate.noDelegatesShort' : 'delegate.noDelegatorsShort')} />
      ) : !groups.size ? (
        <Placeholder emoji="🥐" title={t(byMe.value ? 'delegate.noDelegatedTasksTo' : 'delegate.noDelegatedTasks')} />
      ) : (
        [...groups].map(([name, list]) => (
          <section key={name}>
            <h3 class="section-header">{name}</h3>
            {list.map((todo) => <TodoCard key={todo.id} todo={todo} type={byMe.value ? 'delegatedByMe' : 'delegatedToMe'} />)}
          </section>
        ))
      )}
    </div>
  )
}

export const openDelegationSettings = () => open((close) => <DelegationSettings close={close} />)

function DelegationSettings({ close }: { close: () => void }) {
  const busy = useSignal(false)
  const token = session.value?.delegateInviteToken
  const link = token ? `https://todorant.com/invite/${token}` : ''
  const copy = () => navigator.clipboard.writeText(link).then(() => toast(t('success')), showError)
  const resetToken = async () => {
    if (!(await confirm(t('delegate.resetConfirmation'), t('refresh'), true))) return
    busy.value = true
    try {
      const { token } = await call<{ token: string }>('POST', '/v2/delegation/token')
      if (session.value) session.value = { ...session.value, delegateInviteToken: token }
    } catch (e) {
      showError(e)
    } finally {
      busy.value = false
    }
  }
  const list = (title: string, empty: string, users: Person[], delegator: boolean) => (
    <>
      <h3 class="subheader">{t(title)}</h3>
      {!users.length && <p class="muted">{t(empty)}</p>}
      {users.map((user) => (
        <div key={user.id} class="row">
          <span class="grow person-name">{user.name}</span>
          <IconButton icon="delete" size={20} color="var(--red)" title={`${t('delete')} ${user.name}`} disabled={busy.value} onClick={() => remove(user, delegator)} />
        </div>
      ))}
    </>
  )
  const remove = async (user: Person, delegator: boolean) => {
    if (!(await confirm(t(delegator ? 'delegate.deleteDelegatorConfirmation' : 'delegate.deleteDelegateConfirmation'), t('delete'), true))) return
    busy.value = true
    try {
      await call('DELETE', `/v2/delegation/${delegator ? 'delegators' : 'delegates'}/${user.id}`)
      // Like the apps: the tasks shared with that person go away here too
      for (const todo of [...todos.values()])
        if (!todo.deleted && (delegator ? todo.delegator === user.id : todo.user === user.id && todo.delegator === session.value?.id))
          update('todo', todo.id, { deleted: true, delegateAccepted: true })
      sync()
    } catch (e) {
      showError(e)
    } finally {
      busy.value = false
    }
  }
  return (
    <DialogCard title={t('delegate.title')} actions={<Button autofocus onClick={close}>{t('close')}</Button>}>
      <h3 class="subheader">{t('delegate.link')}</h3>
      <p class="muted">{t('delegate.linkDescription')}</p>
      <div class="row">
        <IconButton icon="content_copy" title="Copy" disabled={!link} onClick={copy} />
        <IconButton icon="refresh" title={t('delegate.resetConfirmation')} disabled={busy.value} onClick={resetToken} />
        <code class="grow invite-link">{link}</code>
      </div>
      {list('delegate.delegates', 'delegate.noDelegates', people.value.delegates, false)}
      {list('delegate.delegators', 'delegate.noDelegators', people.value.delegators, true)}
    </DialogCard>
  )
}
