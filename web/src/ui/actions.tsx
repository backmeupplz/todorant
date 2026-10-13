import { update, type Todo } from '../data/store'
import { t } from '../i18n'
import { ellipsize } from '../lib/text'
import * as todos from '../logic/todos'
import { Button, confetti, confirm, DialogCard, open, playComplete } from './kit'

const form = () => import('../views/TodoForm')

/** Add dialog, optionally for a day/month title and prefilled text */
export const addTodo = (title?: string, text?: string) => form().then((m) => m.openForm({ mode: 'add', title, text }))
export const editTodo = (todo: Todo, accepting = false) => form().then((m) => m.openForm({ mode: 'edit', todo, accepting }))
export const breakdownTodo = (todo: Todo) => form().then((m) => m.openForm({ mode: 'breakdown', todo }))

/** A todo moved too often has to be broken down instead */
export const requestBreakdown = (todo: Todo) =>
  open((close) => (
    <DialogCard
      title={t('breakdown.request')}
      actions={
        <>
          <Button text onClick={close}>{t('cancel')}</Button>
          <Button autofocus onClick={() => (close(), breakdownTodo(todo))}>{t('breakdown.button')}</Button>
        </>
      }
    />
  ))

export async function deleteTodo(todo: Todo) {
  if (await confirm(t('deleteHeadline', { name: ellipsize(todo.text, 50) }), t('delete'), true)) update('todo', todo.id, { deleted: true })
}

/** Completes with sound, frog reminder and confetti; repetitive todos offer a breakdown instead */
export function completeTodo(todo: Todo) {
  if (!todo.repetitive) return complete(todo)
  open((close) => (
    <DialogCard
      title={t('breakdownMessage.title')}
      actions={
        <>
          <Button text onClick={close}>{t('close')}</Button>
          <Button color="success" onClick={() => (close(), complete(todo))}>{t('breakdownMessage.complete')}</Button>
          <Button autofocus onClick={() => (close(), breakdownTodo(todo))}>{t('breakdown.button')}</Button>
        </>
      }
    >
      {t('breakdownMessage.text')}
    </DialogCard>
  ))
}

function complete(todo: Todo) {
  todos.markCompleted(todo)
  playComplete(todo.frog)
  if (!todo.frog && todos.frogsLeftToday())
    open((close) => (
      <DialogCard title={t('frogsAlert.title')} actions={<Button autofocus onClick={close}>{t('close')}</Button>}>
        {t('frogsAlert.text')}
      </DialogCard>
    ))
  confetti()
}
