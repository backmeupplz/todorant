import { useSignal } from '../lib/state'
import { useEffect, useRef } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { addHeroPoint, create, encryptionKey, people, prefs, session, settings, todos as allTodos, update, type Person, type Todo } from '../data/store'
import { locale, t } from '../i18n'
import { dateString, isOld, monthOf, today } from '../lib/time'
import { hashtags } from '../lib/text'
import * as todos from '../logic/todos'
import { Button, confetti, IconButton, InfoButton, open, playComplete, Sheet, Switch, toast } from '../ui/kit'
import { TodoCard } from '../ui/TodoCard'
import { DayPicker, MonthPicker, PickerRow, TimePicker } from '../ui/pickers'
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
  /** Folded into a one-line summary (forms with several todos) */
  collapsed?: boolean
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
  open((close) => <TodoForm {...p} close={close} />, true, true)
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
  // A new todo opens below the others, which fold into one-line summaries
  const add = () =>
    (slots.value = [
      ...slots.value.map((s) => ({ ...s, collapsed: true })),
      slot(mode === 'breakdown' && settings.value.duplicateTagInBreakdown && todo ? { text: hashtags(todo.text).map((h) => `#${h} `).join('') } : {}),
    ])
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

  const heading = mode === 'edit' ? t('m.editTodo') : mode === 'breakdown' ? t('m.breakdownTodo') : t('m.addTodo')
  const label = mode === 'edit' ? t('m.saveTodo') : slots.value.length > 1 ? t('m.addTodoPlural') : t('m.addTodoSingular')
  return (
    <Sheet
      title={heading}
      onClose={close}
      actions={<InfoButton text={mode === 'edit' ? 'm.infoEdit' : mode === 'breakdown' ? 'm.infoBreakdown' : 'm.infoAdd'} />}
      footer={
        <>
          <Button onClick={() => void save()} disabled={!ok}>{label}</Button>
          {mode !== 'edit' && (
            <button type="button" class="btn btn-primary add-slot" title={`${t('m.addTodo')} (ctrl+shift+a)`} aria-label={t('m.addTodo')} onClick={add}>
              <Icon name="add_plain" size={22} />
            </button>
          )}
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
    </Sheet>
  )
}

const monthName = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
}
/** "Tue, Oct 13" (with the year when it isn't this year) */
const dayName = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
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
  const picker = useSignal<'day' | 'month' | 'time' | 'delegate' | null>(null)
  const toggle = (which: 'day' | 'month' | 'time' | 'delegate') => (picker.value = picker.value === which ? null : which)
  const when = s.date && s.monthAndYear ? dayName(`${s.monthAndYear}-${s.date}`) : s.monthAndYear ? monthName(s.monthAndYear) : ''
  const header = p.count > 1 && (
    <div class="slot-head">
      <button type="button" class="slot-summary" aria-expanded={!s.collapsed} onClick={() => p.onChange({ collapsed: !s.collapsed })}>
        <Icon name={s.collapsed ? 'expand_more' : 'expand_less'} size={20} />
        <b>#{p.index + 1}</b>
        {s.collapsed && <span class={valid(s) ? 'summary' : 'summary invalid'}>{(locked ? t('encryption.encryptedTodo') : s.text.trim()) || t('todo.create.text')}</span>}
        {s.collapsed && when && <span class="when">{when}</span>}
      </button>
      <IconButton icon="close" title={t('delete')} onClick={p.onRemove} />
    </div>
  )
  if (s.collapsed) return <section class="slot collapsed">{header}</section>
  return (
    <section class="slot">
      {header}
      <textarea
        ref={ref}
        class={`slot-text${s.text.length > 1500 ? ' invalid' : ''}`}
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
        <div class="tags">
          {suggestions.map((tag, i) => (
            <button key={tag.id} type="button" class="chip" style={{ color: tag.color || 'var(--link)' }} onClick={() => insertTag(tag.tag)}>
              {ctrl.value && <b>{i + 1}</b>}#{tag.tag}
            </button>
          ))}
        </div>
      )}
      <PickerRow label={t('m.addTodoDay')} value={s.date && s.monthAndYear ? dayName(`${s.monthAndYear}-${s.date}`) : ''} open={picker.value === 'day'}
        onToggle={() => toggle('day')} onClear={() => p.onChange({ date: null })}>
        <DayPicker value={s.date && s.monthAndYear ? `${s.monthAndYear}-${s.date}` : null} min={min} onPick={(day) => (p.onChange(dayFields(day)), (picker.value = null))} />
      </PickerRow>
      <PickerRow label={t('m.addTodoMonth')} value={!s.date && s.monthAndYear ? monthName(s.monthAndYear) : ''} open={picker.value === 'month'}
        onToggle={() => toggle('month')} onClear={() => p.onChange({ monthAndYear: null, date: null })}>
        <MonthPicker value={!s.date ? s.monthAndYear : null} min={min.slice(0, 7)} onPick={(month) => (p.onChange({ monthAndYear: month, date: null }), (picker.value = null))} />
      </PickerRow>
      <Switch row label={t('todo.create.frog')} checked={s.frog} onChange={(frog) => p.onChange({ frog })} />
      <Switch row label={t('completed')} checked={s.completed} onChange={(completed) => p.onChange({ completed })} />
      {s.more ? (
        <>
          <PickerRow label={t('m.addTodoTime')} value={s.time} open={picker.value === 'time'} onToggle={() => toggle('time')} onClear={() => p.onChange({ time: null })}>
            <TimePicker value={s.time} onPick={(time) => {
              const minutePicked = s.time !== null && s.time !== undefined && time.slice(0, 2) === s.time.slice(0, 2)
              p.onChange(!s.date ? { time, ...dayFields(dateString(today())) } : { time })
              if (minutePicked) picker.value = null
            }} />
          </PickerRow>
          {!p.editing && <Switch row label={t('m.addTodoOnTop')} checked={s.goFirst} onChange={(goFirst) => p.onChange({ goFirst })} />}
          <Switch row label={t('breakdownMessage.title')} checked={s.repetitive} onChange={(repetitive) => p.onChange({ repetitive })} />
          {!p.editing && delegates.length > 0 && (
            <PickerRow label={t('delegate.title')} value={s.delegate?.name} open={picker.value === 'delegate'} onToggle={() => toggle('delegate')} onClear={() => p.onChange({ delegate: undefined })}>
              <div class="picker-list">
                {delegates.map((d) => (
                  <button key={d.id} type="button" aria-pressed={s.delegate?.id === d.id} onClick={() => (p.onChange({ delegate: d }), (picker.value = null))}>
                    {d.name}
                  </button>
                ))}
              </div>
            </PickerRow>
          )}
        </>
      ) : (
        <button type="button" class="table-row more-row" onClick={() => p.onChange({ more: true })}>
          <span class="label">{t('m.addTodoMore')}</span>
          <Icon name="chevron_right" size={20} />
        </button>
      )}
    </section>
  )
}
