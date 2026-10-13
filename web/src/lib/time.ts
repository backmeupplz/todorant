import { settings } from '../data/store'

const pad = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" of a local date */
export const dateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const monthOf = (d: Date) => dateString(d).slice(0, 7)
export const dayOf = (d: Date) => dateString(d).slice(8, 10)
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Minutes since midnight of "HH:mm", null when malformed */
export function minutes(time?: string | null) {
  const m = time?.match(/^(\d{1,2}):(\d{2})$/)
  return m ? +m[1] * 60 + +m[2] : null
}

/** Today, shifted back a day while it's earlier than the "start time of day" setting */
export function today(now = new Date(), start = settings.value.startTimeOfDay || '00:00') {
  const d = new Date(now)
  if ((minutes(hhmm(now)) ?? 0) < (minutes(start) ?? 0)) d.setDate(d.getDate() - 1)
  return d
}
export const todayTitle = () => dateString(today())

/** "YYYY-MM" or "YYYY-MM-DD" → local date (first of month for the former) */
export function parseTitle(title: string) {
  const [y, m, d] = title.split('-').map(Number)
  return new Date(y, m - 1, d || 1)
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** A todo is old when its day has passed, or (month-only) when its month has come */
export function isOld(monthAndYear?: string | null, date?: string | null, now = new Date()) {
  if (!monthAndYear) return false
  if (date) return `${monthAndYear}-${date}` < dateString(today(now))
  return monthAndYear <= monthOf(now)
}
