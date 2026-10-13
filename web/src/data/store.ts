import { signal } from '@preact/signals'
import * as idb from './idb'

/** Synced fields per collection; must match backend/src/v2/schema.ts */
export const FIELDS = {
  todo: ['text', 'completed', 'frog', 'frogFails', 'skipped', 'order', 'monthAndYear', 'date', 'time', 'deleted', 'encrypted', 'repetitive', 'delegateAccepted'],
  tag: ['tag', 'color', 'deleted', 'epic', 'epicCompleted', 'epicGoal', 'epicPoints', 'epicOrder', 'numberOfUses'],
  settings: ['showTodayOnAddTodo', 'firstDayOfWeek', 'startTimeOfDay', 'newTodosGoFirst', 'preserveOrderByTime', 'duplicateTagInBreakdown', 'showMoreByDefault', 'language', 'removeCompletedFromCalendar', 'googleCalendarCredentials'],
} as const

export type Todo = {
  id: string
  text: string
  completed: boolean
  frog: boolean
  frogFails: number
  skipped: boolean
  order: number
  monthAndYear?: string | null
  date?: string | null
  time?: string | null
  deleted: boolean
  encrypted: boolean
  repetitive: boolean
  delegateAccepted?: boolean | null
  user?: string | null
  delegator?: string | null
  createdAt?: number
  updatedAt?: number
}
export type Tag = {
  id: string
  tag: string
  color?: string | null
  deleted: boolean
  epic: boolean
  epicCompleted: boolean
  epicGoal: number
  epicPoints: number
  epicOrder: number
  numberOfUses: number
}
export type Settings = {
  showTodayOnAddTodo?: boolean
  firstDayOfWeek?: number
  startTimeOfDay?: string
  newTodosGoFirst?: boolean
  preserveOrderByTime?: boolean
  duplicateTagInBreakdown?: boolean
  showMoreByDefault?: boolean
  language?: string
  removeCompletedFromCalendar?: boolean
  googleCalendarCredentials?: object | null
}
export type Profile = {
  id: string
  token: string
  name: string
  email?: string
  facebookId?: string
  telegramId?: string
  appleSubId?: string
  delegateInviteToken?: string
}
export type Person = { id: string; name: string }
/** One queued field edit; `id` is '' for the singleton collections (settings, user, hero) */
export type Change = { c: string; id: string; field: string; value: unknown; at: number }

// region Local preferences (this browser only)

function local<T>(key: string, fallback: T) {
  let initial = fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw != null) initial = JSON.parse(raw)
  } catch {}
  const s = signal<T>(initial)
  s.subscribe((v) => {
    try {
      v === undefined || v === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v))
    } catch {}
  })
  return s
}

export const session = local<Profile | null>('session', null)
export const encryptionKey = local<string | null>('password', null)
export const prefs = local('prefs', {
  dark: matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  sound: true,
  hotkeys: true,
  swipe: false,
  newLineOnReturn: false,
  coloredCards: false,
  rulesShown: false,
  language: '' as string,
})
export const setPref = <K extends keyof typeof prefs.value>(key: K, value: (typeof prefs.value)[K]) =>
  (prefs.value = { ...prefs.value, [key]: value })

// endregion

// region Synced state (IndexedDB)

export const todos = new Map<string, Todo>()
export const tags = new Map<string, Tag>()
const outbox = new Map<string, Change>()
export const settings = signal<Settings>({})
export const hero = signal(0)
export const people = signal<{ delegates: Person[]; delegators: Person[] }>({ delegates: [], delegators: [] })
export let cursor: number | null = null
/** Bumped on every data change; views read it to recompute */
export const rev = signal(0)
export const loaded = signal(false)

/** Server clock minus local clock */
export let offset = 0
export const setOffset = (v: number) => (offset = v)
export const now = () => Date.now() + offset

let onChange = () => {}
/** Sync registers to push queued changes */
export const setOnChange = (f: () => void) => (onChange = f)

const dirty = new Map<string, [idb.Store, string, unknown]>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
function persist(store: idb.Store, key: string, value: unknown) {
  dirty.set(`${store}|${key}`, [store, key, value])
  rev.value++
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    const changes = [...dirty.values()]
    dirty.clear()
    idb.write(changes).catch(console.error)
  }, 100)
}
const persistMeta = () => {
  persist('meta', 'outbox', [...outbox.values()])
  persist('meta', 'state', { cursor, settings: settings.value, hero: hero.value, people: people.value })
}

export async function load() {
  const [t, g, meta] = await Promise.all([idb.all<Todo>('todo'), idb.all<Tag>('tag'), idb.all<any>('meta')])
  t.forEach((v, k) => todos.set(k, v))
  g.forEach((v, k) => tags.set(k, v))
  for (const c of meta.get('outbox') ?? []) outbox.set(key(c), c)
  const state = meta.get('state')
  if (state) {
    cursor = state.cursor
    settings.value = state.settings ?? {}
    hero.value = state.hero ?? 0
    people.value = state.people ?? people.value
  }
  loaded.value = true
  rev.value++
}

export async function reset() {
  todos.clear()
  tags.clear()
  outbox.clear()
  cursor = null
  settings.value = {}
  hero.value = 0
  people.value = { delegates: [], delegators: [] }
  await idb.clear()
  rev.value++
}

export function setCursor(value: number | null) {
  cursor = value
  persistMeta()
}

// endregion

// region Outbox

const key = (c: Change) => `${c.c}|${c.id}|${c.field}`

/** Queues a field edit; a newer edit of the same field replaces the older one */
export function enqueue(c: string, id: string, field: string, value: unknown, at = now()) {
  const change = { c, id, field, value: value ?? null, at }
  outbox.set(key(change), change)
  persistMeta()
  onChange()
}

export const pending = () => [...outbox.values()]
const pendingFields = (c: string, id: string) => new Set(pending().filter((x) => x.c === c && x.id === id).map((x) => x.field))

/** The server has these; edits made since (newer `at`) stay queued */
export function acknowledge(sent: Change[]) {
  for (const c of sent) if (outbox.get(key(c))?.at === c.at) outbox.delete(key(c))
  persistMeta()
}

// endregion

// region Documents

const COLLECTIONS = { todo: todos, tag: tags } as const
type Doc = { todo: Todo; tag: Tag }

/** 24-hex Mongo ObjectId, so documents keep one id everywhere */
let counter = Math.floor(Math.random() * 0xffffff)
export function objectId() {
  const hex = (n: number, len: number) => n.toString(16).padStart(len, '0').slice(-len)
  const rand = [...crypto.getRandomValues(new Uint8Array(5))].map((b) => hex(b, 2)).join('')
  return hex(Math.floor(Date.now() / 1000), 8) + rand + hex(counter++, 6)
}

/** Creates a document; every field that's set goes to the server */
export function create<C extends keyof Doc>(c: C, doc: Omit<Doc[C], 'id'> & { id?: string }): Doc[C] {
  const at = now()
  const created = { ...doc, id: doc.id ?? objectId(), createdAt: at, updatedAt: at } as unknown as Doc[C]
  ;(COLLECTIONS[c] as Map<string, Doc[C]>).set(created.id, created)
  persist(c, created.id, created)
  for (const f of FIELDS[c]) {
    const v = (created as any)[f]
    if (v !== undefined && v !== null) enqueue(c, created.id, f, v, at)
  }
  // Delegation is set on creation only, in the same op as the rest
  if (c === 'todo') for (const f of ['user', 'delegator'] as const) if ((created as Todo)[f]) enqueue(c, created.id, f, (created as Todo)[f], at)
  return created
}

/** Changes fields of a document; only the ones that actually change are queued */
export function update<C extends keyof Doc>(c: C, id: string, patch: Partial<Doc[C]>) {
  const doc = (COLLECTIONS[c] as Map<string, Doc[C]>).get(id)
  if (!doc) return
  const at = now()
  const next = { ...doc, updatedAt: at } as any
  let changed = false
  for (const [f, v] of Object.entries(patch)) {
    if (v === next[f] || !(FIELDS[c] as readonly string[]).includes(f)) continue
    next[f] = v
    enqueue(c, id, f, v, at)
    changed = true
  }
  if (!changed) return
  // A todo switching encryption sends its text again, (de)crypted accordingly
  if (c === 'todo' && 'encrypted' in patch && !('text' in patch)) enqueue(c, id, 'text', next.text, at)
  ;(COLLECTIONS[c] as Map<string, Doc[C]>).set(id, next)
  persist(c, id, next)
}

const DEFAULTS = {
  todo: { text: '', completed: false, frog: false, frogFails: 0, skipped: false, order: 0, deleted: false, encrypted: false, repetitive: false },
  tag: { tag: '', deleted: false, epic: false, epicCompleted: false, epicGoal: 0, epicPoints: 0, epicOrder: 0, numberOfUses: 0 },
}

/** A server version of a document; fields with local edits still queued keep their local values */
export function applyRemote(c: 'todo' | 'tag', json: any) {
  const map = COLLECTIONS[c] as Map<string, any>
  const skip = pendingFields(c, json.id)
  const doc = { ...(map.get(json.id) ?? DEFAULTS[c]) }
  for (const [f, v] of Object.entries(json)) if (!skip.has(f)) doc[f] = v
  map.set(json.id, doc)
  persist(c, json.id, doc)
}

/** Server settings / hero points, skipping fields with queued local edits */
export function applySingleton(c: 'settings' | 'hero' | 'user', json: any) {
  const skip = pendingFields(c, '')
  const take = (f: string) => f in json && !skip.has(f)
  if (c === 'settings') {
    const next = { ...settings.value } as any
    for (const f of FIELDS.settings) if (take(f)) next[f] = json[f]
    settings.value = next
  } else if (c === 'hero') {
    if (take('points')) hero.value = json.points
  } else if (session.value) {
    const profile = { ...session.value }
    for (const f of ['name', 'email', 'facebookId', 'telegramId', 'appleSubId', 'delegateInviteToken'] as const) {
      if (f in json && !(f === 'name' && skip.has('name'))) (profile as any)[f] = json[f] ?? undefined
    }
    session.value = profile
  }
  persistMeta()
}

export function setPeople(value: typeof people.value) {
  people.value = value
  persistMeta()
}

export function setSetting<K extends keyof Settings>(field: K, value: Settings[K]) {
  if (settings.value[field] === value) return
  settings.value = { ...settings.value, [field]: value }
  enqueue('settings', '', field, value)
}

export function setName(name: string) {
  if (!session.value || session.value.name === name) return
  session.value = { ...session.value, name }
  enqueue('user', '', 'name', name)
}

export function addHeroPoint() {
  hero.value++
  enqueue('hero', '', 'points', hero.value)
}

// endregion
