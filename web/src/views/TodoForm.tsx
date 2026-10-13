import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { addHeroPoint, create, encryptionKey, people, prefs, session, settings, todos as allTodos, update, type Person, type Todo } from '../data/store'
import { t } from '../i18n'
import { dateString, isOld, monthOf, today } from '../lib/time'
import { hashtags } from '../lib/text'
import * as todos from '../logic/todos'
import { Button, confetti, DialogCard, IconButton, open, playComplete, Switch, toast } from '../ui/kit'
import { TodoCard } from '../ui/TodoCard'
import { requestBreakdown } from '../ui/actions'
import './TodoForm.css'

type Mode = 'add' | 'edit' | 'breakdown'
type Slot = {
  key: number
  text: string
  monthAndYear?: string | null
  date?: string | null
  time?: string | null
  frog: boolean
  completed: boolean
  goFirst: boolean
  repetitive: boolean
  delegate?: Person
  more: boolean
  edited?: Todo
}

let keys = 0
function slot(init: Partial<Slot> = {}): Slot {
  const s: Slot = { key: ++keys, text: '', frog: false, completed: false, goFirst: !!settings.value.newTodosGoFirst, repetitive: false, more: !!settings.value.showMoreByDefault, ...init }
  if (s.monthAndYear === undefined && settings.value.showTodayOnAddTodo) Object.assign(s, dayFields(dateString(today())))
  return s
}
/** "YYYY-MM-DD" / "YYYY-MM" → fields */
const dayFields = (title: string) => ({ monthAndYear: title.slice(0, 7), date: title.length === 10 ? title.slice(8) : null })
const valid = (s: Slot) => !!s.text.trim() && s.text.length <= 1500 && (!!s.monthAndYear || !!s.delegate)

export function openForm(p: { mode: Mode; todo?: Todo; title?: string; text?: string; accepting?: boolean }) {
  open((close) => <TodoForm {...p} close={close} />, true)
}

function TodoForm({ mode, todo, title, text, accepting, close }: { mode: Mode; todo?: Todo; title?: string; text?: string; accepting?: boolean; close: () => void }) {
  const first = (): Slot => {
    if (mode === 'edit' && todo) return slot({ ...todo, goFirst: false, edited: todo, more: !!todo.time || !!settings.value.showMoreByDefault })
    if (mode === 'breakdown' && todo) {
      if (todo.repetitive) return slot({ text: todo.text, time: todo.time, repetitive: true })
      return slot({ text: settings.value.duplicateTagInBreakdown ? hashtags(todo.text).map((h) => `#${h} `).join('') : '' })
    }
    return slot({ text: text ?? '', ...(title ? dayFields(title) : {}) })
  }
  const slots = useSignal<Slot[]>([first()])
  const set = (key: number, patch: Partial<Slot>) => (slots.value = slots.value.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  const add = () => (slots.value = [...slots.value, slot(mode === 'breakdown' && settings.value.duplicateTagInBreakdown && todo ? { text: hashtags(todo.text).map((h) => `#${h} `).join('') } : {})])
  const ok = slots.value.every(valid)

  function save() {
    if (!ok) return toast(t('errors.invalidForm'), true)
    const titles: string[] = []
    const onTop: string[] = []
    const onBottom: string[] = []
    const me = session.value?.id
    let anyCompleted = mode === 'breakdown'
    let anyFrog = mode === 'breakdown' && !!todo?.frog
    for (const [i, s] of slots.value.entries()) {
      const fields = {
        text: s.text.trim(), completed: s.completed, frog: s.frog, time: s.time || null, repetitive: s.repetitive,
        monthAndYear: s.monthAndYear ?? (s.delegate ? null : monthOf(new Date())), date: s.date || null,
      }
      anyCompleted ||= s.completed && !s.edited?.completed
      anyFrog ||= s.frog
      if (s.edited) {
        const e = allTodos.get(s.edited.id) ?? s.edited
        const moved = e.monthAndYear !== fields.monthAndYear || (e.date ?? null) !== fields.date
        if (e.frogFails > 2 && moved) {
          close()
          return requestBreakdown(e)
        }
        const patch: Partial<Todo> = { ...fields }
        if (moved && !e.completed && isOld(e.monthAndYear, e.date) && fields.date) {
          patch.frogFails = e.frogFails + 1
          if (patch.frogFails > 1) patch.frog = true
        }
        if (accepting) patch.delegateAccepted = true
        if (s.completed && !e.completed) todos.incrementEpicPoints(fields.text), addHeroPoint()
        titles.push(todos.titleOf(e))
        update('todo', e.id, patch)
        titles.push(todos.titleOf({ ...e, ...patch }))
      } else {
        const created = create('todo', {
          ...fields, order: i, frogFails: 0, skipped: false, deleted: false,
          encrypted: !!encryptionKey.value && !s.delegate,
          ...(s.delegate && me ? { user: s.delegate.id, delegator: me } : {}),
        })
        if (s.completed) todos.incrementEpicPoints(fields.text), addHeroPoint()
        titles.push(todos.titleOf(created))
        ;(s.goFirst ? onTop : onBottom).push(created.id)
      }
    }
    if (mode === 'breakdown' && todo) {
      const original = allTodos.get(todo.id) ?? todo
      todos.markCompleted(original)
      titles.push(todos.titleOf(original))
      confetti()
    }
    if (anyCompleted) playComplete(anyFrog)
    todos.addTags(slots.value.map((s) => s.text))
    todos.fixOrder(titles.filter(Boolean), { onTop, onBottom })
    close()
  }

  const heading = mode === 'edit' ? t('todo.edit.title') : mode === 'breakdown' ? t('breakdown.button') : t('todo.create.title')
  return (
    <DialogCard
      wide
      title={heading}
      actions={
        <>
          {mode !== 'edit' && <IconButton icon="add_plain" title={t('todo.create.title')} onClick={add} />}
          <span class="grow" />
          <Button text onClick={close}>{t('cancel')}</Button>
          <Button onClick={() => void save()} disabled={!ok}>{t('save')}</Button>
        </>
      }
    >
      {mode === 'breakdown' && todo && (
        <div class="breakdown-original">
          <TodoCard todo={todo} type="done" />
        </div>
      )}
      {slots.value.map((s, i) => (
        <SlotForm
          key={s.key}
          slot={s}
          index={i}
          count={slots.value.length}
          editing={mode === 'edit'}
          onChange={(patch) => set(s.key, patch)}
          onRemove={() => (slots.value = slots.value.filter((x) => x.key !== s.key))}
          onSave={save}
          onAdd={add}
        />
      ))}
    </DialogCard>
  )
}

function SlotForm(p: { slot: Slot; index: number; count: number; editing: boolean; onChange: (patch: Partial<Slot>) => void; onRemove: () => void; onSave: () => void; onAdd: () => void }) {
  const s = p.slot
  const ref = useRef<HTMLTextAreaElement>(null)
  const ctrl = useSignal(false)
  useEffect(() => {
    if (p.index === p.count - 1) ref.current?.focus()
  }, [])
  const suggestions = todos.suggestions(s.text, s.more).slice(0, 9)
  const insertTag = (tag: string) => {
    const text = s.text.replace(/#[Ѐ-ӿa-zA-Z_0-9]*$/, '')
    p.onChange({ text: `${text}${text && !text.endsWith(' ') ? ' ' : ''}#${tag} ` })
    ref.current?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    ctrl.value = e.ctrlKey || e.metaKey
    const newLine = prefs.value.newLineOnReturn ? !e.shiftKey : e.shiftKey
    if (e.key === 'Enter' && !newLine) {
      e.preventDefault()
      p.onSave()
    } else if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key) && suggestions[+e.key - 1]) {
      e.preventDefault()
      insertTag(suggestions[+e.key - 1].tag)
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      p.onAdd()
    }
  }
  const min = dateString(today())
  // Without the right password the text can't be shown or changed, only the rest of the todo
  const locked = !!s.edited && todos.unreadable(s.edited)
  const delegates = people.value.delegates
  return (
    <section class="slot">
      {p.count > 1 && (
        <div class="row">
          <b class="grow">#{p.index + 1}</b>
          <IconButton icon="close" title={t('delete')} onClick={p.onRemove} />
        </div>
      )}
      <textarea
        ref={ref}
        class={`input${s.text.length > 1500 ? ' invalid' : ''}`}
        rows={2}
        placeholder={locked ? t('encryption.errorDecrypting') : t('todo.create.text')}
        aria-label={t('todo.create.text')}
        value={locked ? '' : s.text}
        disabled={locked}
        onInput={(e) => p.onChange({ text: e.currentTarget.value })}
        onKeyDown={onKey}
        onKeyUp={(e) => (ctrl.value = e.ctrlKey || e.metaKey)}
        onBlur={() => (ctrl.value = false)}
      />
      {suggestions.length > 0 && (
        <div class="row wrap tags">
          {suggestions.map((tag, i) => (
            <button key={tag.id} type="button" class="chip" style={{ color: tag.color || 'var(--link)' }} onClick={() => insertTag(tag.tag)}>
              {ctrl.value && <b>{i + 1}</b>}#{tag.tag}
            </button>
          ))}
        </div>
      )}
      <div class="row wrap">
        <label class="field grow">
          <span>{t('todo.create.date')}</span>
          <input type="date" min={min} value={s.date && s.monthAndYear ? `${s.monthAndYear}-${s.date}` : ''} onInput={(e) => {
            const v = e.currentTarget.value
            p.onChange(v ? dayFields(v) : { date: null })
          }} />
        </label>
        <label class="field grow">
          <span>{t('todo.create.month')}</span>
          <input type="month" min={min.slice(0, 7)} value={!s.date ? s.monthAndYear ?? '' : ''} onInput={(e) => p.onChange({ monthAndYear: e.currentTarget.value || null, date: null })} />
        </label>
      </div>
      <div class="row wrap switches">
        <Switch label={t('todo.create.frog')} checked={s.frog} onChange={(frog) => p.onChange({ frog })} />
        <Switch label={t('completed')} checked={s.completed} onChange={(completed) => p.onChange({ completed })} />
      </div>
      {s.more ? (
        <div class="more">
          <label class="field">
            <span>{t('addTodoTime')}</span>
            <input type="time" value={s.time ?? ''} onInput={(e) => {
              const time = e.currentTarget.value || null
              p.onChange(time && !s.date ? { time, ...dayFields(dateString(today())) } : { time })
            }} />
          </label>
          {!p.editing && <Switch label={t('todo.create.goFirst')} checked={s.goFirst} onChange={(goFirst) => p.onChange({ goFirst })} />}
          <Switch label={t('breakdownMessage.title')} checked={s.repetitive} onChange={(repetitive) => p.onChange({ repetitive })} />
          {!p.editing && delegates.length > 0 && (
            <label class="field">
              <span>{t('delegate.title')}</span>
              <select class="input" value={s.delegate?.id ?? ''} onChange={(e) => p.onChange({ delegate: delegates.find((d) => d.id === e.currentTarget.value) })}>
                <option value="">—</option>
                {delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
        </div>
      ) : (
        <button type="button" class="btn btn-text more-btn" onClick={() => p.onChange({ more: true })}>
          <Icon name="more_horiz" size={20} />
        </button>
      )}
    </section>
  )
}
