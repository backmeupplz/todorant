import * as WebSocket from 'ws'
import { ObjectId } from 'mongodb'
import { DocumentType } from '@typegoose/typegoose'
import { HeroModel } from '@/models/hero'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { User, UserModel } from '@/models/user'
import { fields, isObjectId, sanitize } from '@/v2/schema'
import { publish } from '@/v2/hub'
import { wire } from '@/v2/wire'

/**
 * A pull re-sends what changed in the last few seconds before the cursor: a write that got its
 * timestamp before a pull started but committed after it is never missed (no replica set needed).
 */
const OVERLAP = 5000

export type Op = { c: 'todo' | 'tag' | 'settings' | 'hero' | 'user'; id?: string; at: number; set: Record<string, unknown> }
export type Ack = { c?: string; id?: string; u?: number; fix?: Record<string, unknown>; e?: string }
type UserDoc = DocumentType<User>

const oid = (id: unknown) => new ObjectId(String(id))
const same = (a: unknown, b: unknown) => a !== undefined && a !== null && String(a) === String(b)

function profile(user: UserDoc | Record<string, any>) {
  const { name, email, facebookId, telegramId, appleSubId, delegateInviteToken, settings = {} } = user as Record<string, any>
  return {
    id: String(user._id), name, email, facebookId, telegramId, appleSubId, delegateInviteToken,
    settings: { ...settings, updatedAt: settings.updatedAt?.getTime?.() },
    updatedAt: (user.updatedAt as Date)?.getTime(),
  }
}

async function delegation(user: Record<string, any>, after?: Date) {
  const projection = { name: 1, updatedAt: 1, delegatesUpdatedAt: 1 }
  const [delegates, delegators] = await Promise.all([
    user.delegates?.length ? UserModel.collection.find({ _id: { $in: user.delegates } }, { projection }).toArray() : [],
    UserModel.collection.find({ delegates: user._id }, { projection }).toArray(),
  ])
  const changed = (u: Record<string, any>) => u.updatedAt > after || u.delegatesUpdatedAt > after
  if (after && !(user.delegatesUpdatedAt > after) && ![...delegates, ...delegators].some(changed)) return undefined
  const brief = (u: Record<string, any>) => ({ id: String(u._id), name: u.name })
  return { delegates: delegates.map(brief), delegators: delegators.map(brief) }
}

/** Everything that changed since [since] (server ms from a previous pull), or a full snapshot */
export async function pull(userId: string, since?: number) {
  const cursor = Date.now()
  const after = since ? new Date(since - OVERLAP) : undefined
  const uid = oid(userId)
  const changed = after ? { updatedAt: { $gt: after } } : { deleted: false }
  const projection = { __v: 0, _fts: 0, clientId: 0 }
  const user = await UserModel.collection.findOne({ _id: uid })
  if (!user) throw new Error('User not found')
  const [todos, tags, hero, delegates] = await Promise.all([
    TodoModel.collection.find({ $or: [{ user: uid }, { delegator: uid }], ...changed }, { projection }).toArray(),
    TagModel.collection.find({ user: uid, ...changed }, { projection }).toArray(),
    HeroModel.collection.findOne({ user: uid }),
    delegation(user, after),
  ])
  const result: Record<string, unknown> = {
    cursor,
    todos: todos.map((t) => wire('todo', t)),
    tags: tags.map((t) => wire('tag', t)),
  }
  if (!after || user.updatedAt > after || user.settings?.updatedAt > after) result.user = profile(user)
  if (hero && (!after || hero.updatedAt > after)) result.hero = { points: hero.points, updatedAt: hero.updatedAt?.getTime() }
  if (delegates) result.delegation = delegates
  return result
}

const models = { todo: TodoModel, tag: TagModel }
const defaults = {
  todo: { completed: false, frog: false, frogFails: 0, skipped: false, order: 0, deleted: false, encrypted: false, repetitive: false },
  tag: { deleted: false, epic: false, epicCompleted: false, epicGoal: 0, epicPoints: 0, epicOrder: 0, numberOfUses: 0 },
}

/**
 * Applies todo/tag ops with field-level last-writer-wins on the client edit time (`at`, clamped to now):
 * a field changes only if nobody wrote it later; losing fields come back as `fix` in the ack.
 * Returns the acks and the changed todos (for side effects like the calendar).
 */
async function applyDocs(collection: 'todo' | 'tag', user: Record<string, any>, ops: Op[], now: number, origin?: WebSocket) {
  const model = models[collection]
  const uid = String(user._id)
  const ids = [...new Set(ops.map((o) => o.id).filter(isObjectId))]
  const docs = new Map<string, Record<string, any>>()
  if (ids.length) {
    for (const doc of await model.collection.find({ _id: { $in: ids.map(oid) } }).toArray()) docs.set(String(doc._id), doc)
  }
  const writes: any[] = []
  const acks: Ack[] = []
  const changes = new Map<string, Record<string, unknown>>()
  const date = new Date(now)
  for (const op of ops) {
    if (!isObjectId(op.id)) { acks.push({ id: op.id, e: 'Invalid id' }); continue }
    const at = Math.min(Number(op.at) || now, now)
    let set: Record<string, unknown>
    try { set = sanitize(collection, op.set) } catch (e) { acks.push({ id: op.id, e: (e as Error).message }); continue }
    const doc = docs.get(op.id)
    if (!doc) {
      // Create with the client's id: no client/server id mapping anywhere
      const created: Record<string, any> = { _id: oid(op.id), ...defaults[collection], ...set, user: user._id, createdAt: date, updatedAt: date }
      if (collection === 'todo' && op.set.delegator) {
        const delegate = String(op.set.user)
        if (!same(op.set.delegator, uid) || !user.delegates?.some((d: unknown) => same(d, delegate))) {
          acks.push({ id: op.id, e: 'Invalid delegation' }); continue
        }
        created.user = oid(delegate)
        created.delegator = user._id
        created.delegateAccepted = set.delegateAccepted ?? false
      } else if (collection === 'todo' && !created.monthAndYear) {
        acks.push({ id: op.id, e: 'monthAndYear is required' }); continue
      }
      created._fts = Object.fromEntries(Object.keys(set).map((f) => [f, at]))
      writes.push({ insertOne: { document: created } })
      docs.set(op.id, created)
      changes.set(op.id, wire(collection, created))
      acks.push({ id: op.id, u: now })
      continue
    }
    const mine = same(doc.user, uid) || same(doc.delegator, uid)
    // Delegators can't change todos their delegate already accepted (same rule as v1)
    const locked = collection === 'todo' && same(doc.delegator, uid) && !same(doc.user, uid) && doc.delegateAccepted
    if (!mine) { acks.push({ id: op.id, e: 'Not found' }); continue }
    const fts = doc._fts || {}
    const applied: Record<string, unknown> = {}
    const fix: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(set)) {
      if (!locked && (fts[field] || 0) <= at) applied[field] = value
      else fix[field] = doc[field] ?? null
    }
    if (Object.keys(applied).length) {
      const $set: Record<string, unknown> = { ...applied, updatedAt: date }
      for (const field of Object.keys(applied)) $set[`_fts.${field}`] = at
      writes.push({ updateOne: { filter: { _id: doc._id }, update: { $set } } })
      Object.assign(doc, applied, { updatedAt: date })
      for (const field of Object.keys(applied)) fts[field] = at
      doc._fts = fts
      const change = changes.get(op.id) || { id: op.id }
      changes.set(op.id, { ...change, ...applied, updatedAt: now })
    }
    acks.push(Object.keys(fix).length ? { id: op.id, u: now, fix } : { id: op.id, u: now })
  }
  if (writes.length) await model.collection.bulkWrite(writes, { ordered: true })
  // Real time: the user's other devices get only what changed; delegation counterparts get it too
  const key = `${collection}s`
  const list = [...changes.values()]
  if (list.length) {
    publish(uid, { t: 'changes', [key]: list }, origin)
    if (collection === 'todo') {
      const others = new Map<string, Record<string, unknown>[]>()
      for (const change of list) {
        const doc = docs.get(String(change.id))!
        for (const other of [doc.user, doc.delegator]) {
          if (other && !same(other, uid)) others.set(String(other), [...(others.get(String(other)) || []), wire('todo', doc)])
        }
      }
      for (const [other, todos] of others) publish(other, { t: 'changes', todos })
    }
  }
  return { acks, changed: list.map((c) => docs.get(String(c.id))!), counterparts: new Set(list.flatMap((c) => {
    const doc = docs.get(String(c.id))!
    return [doc.user, doc.delegator].filter((u) => u && !same(u, uid)).map(String)
  })) }
}

/** Settings are field-level LWW too; a v1 write after the last v2 write timestamps every field */
async function applySettings(user: Record<string, any>, ops: Op[], now: number) {
  const settings = { ...(user.settings || {}) }
  const meta = { ...(user.settingsFts || {}) }
  const v1At = settings.updatedAt?.getTime?.() || 0
  const base = v1At > (meta._at || 0) ? v1At : 0
  const fix: Record<string, unknown> = {}
  let changed = false
  for (const op of ops) {
    const at = Math.min(Number(op.at) || now, now)
    for (const [field, value] of Object.entries(sanitize('settings', op.set))) {
      if (Math.max(meta[field] || 0, base) <= at) {
        settings[field] = value ?? undefined
        meta[field] = at
        changed = true
        delete fix[field]
      } else fix[field] = settings[field] ?? null
    }
  }
  if (changed) {
    settings.updatedAt = new Date(now)
    meta._at = now
    await UserModel.collection.updateOne({ _id: user._id }, { $set: { settings, settingsFts: meta, updatedAt: new Date(now) } })
  }
  return { c: 'settings', u: now, ...(Object.keys(fix).length ? { fix } : {}) }
}

/**
 * Applies a batch of ops for [userId]; [origin] is the socket that sent them (it doesn't get its own
 * changes echoed). [key] is the client's encryption password, only used for Google Calendar like v1.
 */
export async function push(userId: string, ops: Op[], origin?: WebSocket, key?: string) {
  if (!Array.isArray(ops)) throw new Error('Invalid ops')
  if (ops.length > 5000) throw new Error('Too many ops')
  const now = Date.now()
  const user = await UserModel.collection.findOne({ _id: oid(userId) })
  if (!user) throw new Error('User not found')
  const of = (c: Op['c']) => ops.filter((o) => o && o.c === c)
  const acks: Ack[] = []
  const counterparts = new Set<string>()
  const changedTodos: Record<string, any>[] = []
  for (const collection of ['tag', 'todo'] as const) {
    const batch = of(collection)
    if (!batch.length) continue
    const result = await applyDocs(collection, user, batch, now, origin)
    acks.push(...result.acks.map((a) => ({ c: collection, ...a })))
    result.counterparts.forEach((c) => counterparts.add(c))
    if (collection === 'todo') changedTodos.push(...result.changed)
  }
  if (of('settings').length) acks.push(await applySettings(user, of('settings'), now))
  const hero = of('hero').map((o) => Number(o.set?.points)).filter((p) => Number.isFinite(p) && p >= 0)
  if (hero.length) {
    const result = await HeroModel.collection.findOneAndUpdate(
      { user: user._id }, { $max: { points: Math.max(...hero) }, $set: { updatedAt: new Date(now) }, $setOnInsert: { createdAt: new Date(now) } },
      { upsert: true, returnOriginal: false }
    )
    acks.push({ c: 'hero', u: now, fix: { points: result.value?.points } })
  }
  const name = of('user').map((o) => o.set?.name).filter((n): n is string => typeof n === 'string' && !!n.trim()).pop()
  if (name) {
    await UserModel.collection.updateOne({ _id: user._id }, { $set: { name: name.trim().slice(0, 250), updatedAt: new Date(now) } })
    acks.push({ c: 'user', u: now })
  }
  if (acks.some((a) => a.u && a.c !== 'todo' && a.c !== 'tag')) publish(userId, { t: 'pull' }, origin)
  notifyLegacy([userId, ...counterparts])
  if (changedTodos.length && user.settings?.googleCalendarCredentials) updateCalendar(changedTodos, user, key)
  return acks
}

/** v1 clients (socket.io) learn about v2 writes the same way they learn about each other's */
function notifyLegacy(users: string[]) {
  // Required lazily: sockets/index imports the models, which import this module's plugin
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requestLegacySync } = require('@/sockets')
  for (const user of new Set(users)) requestLegacySync(user)
}

function updateCalendar(todos: Record<string, any>[], user: Record<string, any>, key?: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { updateTodos } = require('@/helpers/googleCalendar')
  updateTodos(todos, user.settings.googleCalendarCredentials, key, user.settings.removeCompletedFromCalendar).catch(() => undefined)
}

