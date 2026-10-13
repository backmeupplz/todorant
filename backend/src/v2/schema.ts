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

const hhmm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const int = (min: number, max: number) => (v: number) =>
  Number.isInteger(v) && v >= min && v <= max

/**
 * What a valid value looks like beyond its type (v1's model validators are the floor). Everything a
 * delegator sets reaches the delegate's apps, so nothing here may be big enough to hang a render.
 */
const checks: { [field: string]: (value: any) => boolean } = {
  text: (v) => v.length <= 10000,
  monthAndYear: (v) => {
    const [, year, month] = /^(\d{4})-(\d{2})$/.exec(v) || []
    return +year > 2018 && +month >= 1 && +month <= 12
  },
  date: (v) => /^(0[1-9]|[12]\d|3[01])$/.test(v),
  time: hhmm,
  frogFails: int(0, 100),
  tag: (v) => /^\S{1,250}$/.test(v),
  // Colors only (#hex, names, rgb()/hsl()): nothing that can end a CSS declaration
  color: (v) => /^[#\w(),.% -]{1,40}$/.test(v),
  startTimeOfDay: hhmm,
  firstDayOfWeek: int(0, 6),
  language: (v) => /^[a-zA-Z]{2,8}([-_][a-zA-Z0-9]{1,8}){0,3}$/.test(v),
  // Google's token response: a few flat strings and numbers, no operators, nesting or megabytes
  googleCalendarCredentials: (v) =>
    !Array.isArray(v) &&
    Object.keys(v).length <= 10 &&
    Object.entries(v).every(
      ([key, x]) =>
        /^[a-z_]{1,40}$/.test(key) &&
        (x === null ||
          Number.isFinite(x) ||
          (typeof x === 'string' && x.length <= 4096))
    ),
}

/** Keeps only known fields with valid values; null clears a field. Throws on anything else. */
export function sanitize(
  collection: Collection,
  set: unknown
): Record<string, unknown> {
  if (!set || typeof set !== 'object') throw new Error('Invalid fields')
  const known = fields[collection] as Record<string, Kind>
  const result: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(set)) {
    if (!Object.prototype.hasOwnProperty.call(known, field)) continue
    if (
      value !== null &&
      (typeof value !== known[field] ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (value !== '' && checks[field] && !checks[field](value)))
    )
      throw new Error(`Invalid ${field}`)
    result[field] = value
  }
  return result
}

export const isObjectId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{24}$/.test(id)

/** An error the client caused: its message is safe to send back (HTTP status 400) */
export const invalid = (message: string) =>
  Object.assign(new Error(message), { status: 400 })
