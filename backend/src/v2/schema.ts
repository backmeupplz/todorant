/**
 * The synced fields of every collection — the single source of truth for v2 validation,
 * the wire format and per-field conflict timestamps (`_fts`).
 */
type Kind = 'string' | 'number' | 'boolean' | 'object'

const todo = {
  text: 'string',
  completed: 'boolean',
  frog: 'boolean',
  frogFails: 'number',
  skipped: 'boolean',
  order: 'number',
  monthAndYear: 'string',
  date: 'string',
  time: 'string',
  deleted: 'boolean',
  encrypted: 'boolean',
  repetitive: 'boolean',
  delegateAccepted: 'boolean',
} as const

const tag = {
  tag: 'string',
  color: 'string',
  deleted: 'boolean',
  epic: 'boolean',
  epicCompleted: 'boolean',
  epicGoal: 'number',
  epicPoints: 'number',
  epicOrder: 'number',
  numberOfUses: 'number',
} as const

const settings = {
  showTodayOnAddTodo: 'boolean',
  firstDayOfWeek: 'number',
  startTimeOfDay: 'string',
  newTodosGoFirst: 'boolean',
  preserveOrderByTime: 'boolean',
  duplicateTagInBreakdown: 'boolean',
  showMoreByDefault: 'boolean',
  language: 'string',
  removeCompletedFromCalendar: 'boolean',
  googleCalendarCredentials: 'object',
} as const

export const fields = { todo, tag, settings } as const
export type Collection = keyof typeof fields

const formats: { [field: string]: RegExp } = {
  monthAndYear: /^\d{4}-\d{2}$/,
  date: /^\d{2}$/,
  time: /^\d{2}:\d{2}$/,
  startTimeOfDay: /^\d{2}:\d{2}$/,
}

/** Keeps only known fields with the right types; null clears a field. Throws on anything else. */
export function sanitize(collection: Collection, set: unknown): Record<string, unknown> {
  if (!set || typeof set !== 'object') throw new Error('Invalid fields')
  const known = fields[collection] as Record<string, Kind>
  const result: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(set)) {
    const kind = known[field]
    if (!kind) continue
    if (value !== null && typeof value !== kind) throw new Error(`Invalid ${field}`)
    if (typeof value === 'string' && formats[field] && value && !formats[field].test(value)) {
      throw new Error(`Invalid ${field}`)
    }
    if (field === 'text' && typeof value === 'string' && value.length > 10000) throw new Error('Text is too long')
    result[field] = value
  }
  return result
}

export const isObjectId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id)
