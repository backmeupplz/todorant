import type { ComponentChildren } from 'preact'
import { settings } from '../data/store'
import { language, locale, t } from '../i18n'
import { useSignal } from '../lib/state'
import { dateString, monthOf, today } from '../lib/time'
import { IconButton } from './kit'
import './pickers.css'

/**
 * Inline pickers that expand under a form row (the app's Add todo screen), instead of the
 * browsers' native date/month/time popups, which look different everywhere.
 */
export function PickerRow(p: { label: string; value?: string | null; open: boolean; onToggle: () => void; onClear?: () => void; children: ComponentChildren }) {
  return (
    <div class={p.open ? 'picker-row open' : 'picker-row'}>
      <div class="table-row">
        <button type="button" class="picker-toggle" aria-expanded={p.open} onClick={p.onToggle}>
          <span class="label">{p.label}</span>
          <span class={p.value ? 'value set' : 'value'}>{p.value || '—'}</span>
        </button>
        {p.value && p.onClear && <IconButton icon="close" size={18} title={t('delete')} class="picker-clear" onClick={p.onClear} />}
      </div>
      {p.open && <div class="picker-panel">{p.children}</div>}
    </div>
  )
}

const firstDay = () => settings.value.firstDayOfWeek ?? (language.value === 'en' ? 0 : 1)
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(locale(), o)

function Header({ label, onPrev, onNext, prevDisabled }: { label: string; onPrev: () => void; onNext: () => void; prevDisabled?: boolean }) {
  return (
    <div class="picker-head">
      <IconButton icon="chevron_left" title="‹" onClick={onPrev} disabled={prevDisabled} />
      <span>{label}</span>
      <IconButton icon="chevron_right" title="›" onClick={onNext} />
    </div>
  )
}

/** A month of days; `value` and `min` are YYYY-MM-DD */
export function DayPicker({ value, min, onPick }: { value?: string | null; min: string; onPick: (day: string) => void }) {
  const start = value ?? dateString(today())
  const shown = useSignal(new Date(+start.slice(0, 4), +start.slice(5, 7) - 1, 1))
  const month = shown.value
  const lead = (month.getDay() - firstDay() + 7) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const todayString = dateString(today())
  const move = (n: number) => (shown.value = new Date(month.getFullYear(), month.getMonth() + n, 1))
  return (
    <div class="day-picker">
      <Header label={fmt(month, { month: 'long', year: 'numeric' })} onPrev={() => move(-1)} onNext={() => move(1)} prevDisabled={monthOf(month) <= min.slice(0, 7)} />
      <div class="picker-grid days">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={`w${i}`} class="weekday">{fmt(new Date(2024, 0, 7 + ((firstDay() + i) % 7)), { weekday: 'narrow' })}</span>
        ))}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = dateString(new Date(month.getFullYear(), month.getMonth(), i + 1))
          return (
            <button key={day} type="button" disabled={day < min} aria-pressed={day === value} class={day === todayString ? 'today' : undefined} onClick={() => onPick(day)}>
              {i + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Twelve months of a year; `value` and `min` are YYYY-MM */
export function MonthPicker({ value, min, onPick }: { value?: string | null; min: string; onPick: (month: string) => void }) {
  const year = useSignal(+(value ?? min).slice(0, 4))
  return (
    <div class="month-picker">
      <Header label={`${year.value}`} onPrev={() => year.value--} onNext={() => year.value++} prevDisabled={year.value <= +min.slice(0, 4)} />
      <div class="picker-grid months">
        {Array.from({ length: 12 }, (_, i) => {
          const month = `${year.value}-${String(i + 1).padStart(2, '0')}`
          return (
            <button key={month} type="button" disabled={month < min} aria-pressed={month === value} onClick={() => onPick(month)}>
              {fmt(new Date(year.value, i, 1), { month: 'short' })}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Hours, then minutes in 5-minute steps; `value` is HH:MM */
export function TimePicker({ value, onPick }: { value?: string | null; onPick: (time: string) => void }) {
  const [h, m] = value ? value.split(':').map(Number) : [null, null]
  return (
    <div class="time-picker">
      <div class="picker-grid hours">
        {Array.from({ length: 24 }, (_, i) => (
          <button key={i} type="button" aria-pressed={i === h} onClick={() => onPick(`${pad(i)}:${pad(m ?? 0)}`)}>
            {pad(i)}
          </button>
        ))}
      </div>
      <div class="picker-grid minutes">
        {Array.from({ length: 12 }, (_, i) => (
          <button key={i} type="button" aria-pressed={i * 5 === m} disabled={h === null} onClick={() => onPick(`${pad(h ?? 0)}:${pad(i * 5)}`)}>
            :{pad(i * 5)}
          </button>
        ))}
      </div>
    </div>
  )
}
