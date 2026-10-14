import * as WebSocket from 'ws'
import { DocumentType } from '@typegoose/typegoose'
import { HeroModel } from '@/models/hero'
import { ObjectId } from 'mongodb'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { User, UserModel } from '@/models/user'
import { invalid, isObjectId, sanitize } from '@/v2/schema'
import { publish } from '@/v2/hub'
import { spend } from '@/v2/auth'
import { wire } from '@/v2/wire'

/**
 * A pull re-sends what changed in the last few seconds before the cursor: a write that got its
 * timestamp before a pull started but committed after it is never missed (no replica set needed).
 */
const OVERLAP = 5000

export type Op = {
  c: 'todo' | 'tag' | 'settings' | 'hero' | 'user'
  id?: string
  at: number
  set: Record<string, unknown>
}
export type Ack = {
  c?: string
  id?: string
  u?: number
  fix?: Record<string, unknown>
  e?: string
}
type UserDoc = DocumentType<User>

const oid = (id: unknown) => new ObjectId(String(id))
const same = (a: unknown, b: unknown) =>
  a !== undefined && a !== null && String(a) === String(b)

function profile(user: UserDoc | Record<string, any>) {
  const {
    name,
    email,
    facebookId,
    telegramId,
    appleSubId,
    passwordLogin,
    delegateInviteToken,
    settings = {},
  } = user as Record<string, any>
  return {
    id: String(user._id),
    name,
    email,
    facebookId,
    telegramId,
    appleSubId,
    passwordLogin,
    delegateInviteToken,
    settings: { ...settings, updatedAt: settings.updatedAt?.getTime?.() },
    updatedAt: (user.updatedAt as Date)?.getTime(),
  }
}

async function delegation(user: Record<string, any>, after?: Date) {
  const projection = { name: 1, updatedAt: 1, delegatesUpdatedAt: 1 }
  const [delegates, delegators] = await Promise.all([
    user.delegates?.length
      ? UserModel.collection
          .find({ _id: { $in: user.delegates } }, { projection })
          .toArray()
      : [],
    UserModel.collection
      .find({ delegates: user._id }, { projection })
      .toArray(),
  ])
  const changed = (u: Record<string, any>) =>
    u.updatedAt > after || u.delegatesUpdatedAt > after
  if (
    after &&
    !(user.delegatesUpdatedAt > after) &&
    ![...delegates, ...delegators].some(changed)
  )
    return undefined
  const brief = (u: Record<string, any>) => ({
    id: String(u._id),
    name: u.name,
  })
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
  if (!user) throw invalid('User not found')
  const [todos, tags, hero, delegates] = await Promise.all([
    TodoModel.collection
      .find(
        { $or: [{ user: uid }, { delegator: uid }], ...changed },
        { projection }
      )
      .toArray(),
    TagModel.collection
      .find({ user: uid, ...changed }, { projection })
      .toArray(),
    HeroModel.collection.findOne({ user: uid }),
    delegation(user, after),
  ])
  const result: Record<string, unknown> = {
    cursor,
    todos: todos.map((t) => wire('todo', t)),
    tags: tags.map((t) => wire('tag', t)),
  }
  if (!after || user.updatedAt > after || user.settings?.updatedAt > after)
    result.user = profile(user)
  if (hero && (!after || hero.updatedAt > after))
    result.hero = { points: hero.points, updatedAt: hero.updatedAt?.getTime() }
  if (delegates) result.delegation = delegates
  // Big pulls are paid for afterwards (the budget allows a debt): they're what a flood costs most
  spend(userId, (todos.length + tags.length) / 1000)
  return result
}

const models = { todo: TodoModel, tag: TagModel }
const defaults = {
  todo: {
    completed: false,
    frog: false,
    frogFails: 0,
    skipped: false,
    order: 0,
    deleted: false,
    encrypted: false,
    repetitive: false,
  },
  tag: {
    deleted: false,
    epic: false,
    epicCompleted: false,
    epicGoal: 0,
    epicPoints: 0,
    epicOrder: 0,
    numberOfUses: 0,
  },
}

/**
 * Applies todo/tag ops with field-level last-writer-wins on the client edit time (`at`, clamped to now):
 * a field changes only if nobody wrote it later; losing fields come back as `fix` in the ack.
 */
async function applyDocs(
  collection: 'todo' | 'tag',
  user: Record<string, any>,
  ops: Op[],
  now: number,
  origin?: WebSocket
) {
  const model = models[collection]
  const uid = String(user._id)
  const ids = [...new Set(ops.map((o) => o.id).filter(isObjectId))]
  const docs = new Map<string, Record<string, any>>()
  // Every acknowledged change has its document loaded above
  const docOf = (id: unknown) => docs.get(String(id)) as Record<string, any>
  if (ids.length) {
    for (const doc of await model.collection
      .find({ _id: { $in: ids.map(oid) } })
      .toArray())
      docs.set(String(doc._id), doc)
  }
  const writes: any[] = []
  const acks: Ack[] = []
  const changes = new Map<string, Record<string, unknown>>()
  const date = new Date(now)
  for (const op of ops) {
    if (!isObjectId(op.id)) {
      acks.push({ id: op.id, e: 'Invalid id' })
      continue
    }
    const at = Math.min(Number(op.at) || now, now)
    let set: Record<string, unknown>
    try {
      set = sanitize(collection, op.set)
    } catch (e) {
      acks.push({ id: op.id, e: (e as Error).message })
      continue
    }
    const doc = docs.get(op.id)
    if (!doc) {
      // Create with the client's id: no client/server id mapping anywhere
      const created: Record<string, any> = {
        _id: oid(op.id),
        ...defaults[collection],
        ...set,
        user: user._id,
        createdAt: date,
        updatedAt: date,
      }
      if (collection === 'todo' && op.set.delegator) {
        const delegate = String(op.set.user)
        if (
          !same(op.set.delegator, uid) ||
          !user.delegates?.some((d: unknown) => same(d, delegate))
        ) {
          acks.push({ id: op.id, e: 'Invalid delegation' })
          continue
        }
        created.user = oid(delegate)
        created.delegator = user._id
        // Only the delegate accepts
        created.delegateAccepted = false
      } else if (collection === 'todo' && !created.monthAndYear) {
        acks.push({ id: op.id, e: 'monthAndYear is required' })
        continue
      } else if (collection === 'tag' && !created.tag) {
        acks.push({ id: op.id, e: 'tag is required' })
        continue
      }
      created._fts = Object.fromEntries(Object.keys(set).map((f) => [f, at]))
      writes.push({ insertOne: { document: created } })
      docs.set(op.id, created)
      changes.set(op.id, wire(collection, created))
      acks.push({ id: op.id, u: now })
      continue
    }
    const mine = same(doc.user, uid) || same(doc.delegator, uid)
    if (!mine) {
      acks.push({ id: op.id, e: 'Not found' })
      continue
    }
    // A delegator edits a delegated todo only until it's accepted (v1's rule) and only while still
    // delegating to that user; accepting is the delegate's call alone
    const delegated = collection === 'todo' && !same(doc.user, uid)
    const locked =
      delegated &&
      (doc.delegateAccepted ||
        !user.delegates?.some((d: unknown) => same(d, doc.user)))
    const fts = doc._fts || {}
    const applied: Record<string, unknown> = {}
    const fix: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(set)) {
      const allowed = !locked && !(delegated && field === 'delegateAccepted')
      if (allowed && (fts[field] || 0) <= at) applied[field] = value
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
    acks.push(
      Object.keys(fix).length
        ? { id: op.id, u: now, fix }
        : { id: op.id, u: now }
    )
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
        const doc = docOf(change.id)
        for (const other of [doc.user, doc.delegator]) {
          if (other && !same(other, uid))
            others.set(String(other), [
              ...(others.get(String(other)) || []),
              wire('todo', doc),
            ])
        }
      }
      for (const [other, todos] of others)
        publish(other, { t: 'changes', todos })
    }
  }
  return {
    acks,
    counterparts: new Set(
      list.flatMap((c) => {
        const doc = docOf(c.id)
        return [doc.user, doc.delegator]
          .filter((u) => u && !same(u, uid))
          .map(String)
      })
    ),
  }
}

/** Settings are field-level LWW too; a v1 write after the last v2 write timestamps every field */
async function applySettings(
  user: Record<string, any>,
  ops: Op[],
  now: number
) {
  const settings = { ...(user.settings || {}) }
  const meta = { ...(user.settingsFts || {}) }
  const v1At = settings.updatedAt?.getTime?.() || 0
  const base = v1At > (meta._at || 0) ? v1At : 0
  const fix: Record<string, unknown> = {}
  let changed = false
  let error: string | undefined
  for (const op of ops) {
    const at = Math.min(Number(op.at) || now, now)
    let set: Record<string, unknown>
    try {
      set = sanitize('settings', op.set)
    } catch (e) {
      error = (e as Error).message
      continue
    }
    for (const [field, value] of Object.entries(set)) {
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
    await UserModel.collection.updateOne(
      { _id: user._id },
      { $set: { settings, settingsFts: meta, updatedAt: new Date(now) } }
    )
  }
  return {
    c: 'settings',
    u: now,
    ...(Object.keys(fix).length ? { fix } : {}),
    ...(error ? { e: error } : {}),
  }
}

/**
 * Applies a batch of ops for [userId]; [origin] is the socket that sent them (it doesn't get its own
 * changes echoed).
 */
export async function push(userId: string, ops: Op[], origin?: WebSocket) {
  if (!Array.isArray(ops)) throw invalid('Invalid ops')
  if (ops.length > 5000) throw invalid('Too many ops')
  spend(userId, ops.length / 100)
  const now = Date.now()
  const user = await UserModel.collection.findOne({ _id: oid(userId) })
  if (!user) throw invalid('User not found')
  const of = (c: Op['c']) => ops.filter((o) => o && o.c === c)
  const acks: Ack[] = []
  const counterparts = new Set<string>()
  for (const collection of ['tag', 'todo'] as const) {
    const batch = of(collection)
    if (!batch.length) continue
    const result = await applyDocs(collection, user, batch, now, origin)
    acks.push(...result.acks.map((a) => ({ c: collection, ...a })))
    result.counterparts.forEach((c) => counterparts.add(c))
  }
  if (of('settings').length)
    acks.push(await applySettings(user, of('settings'), now))
  const hero = of('hero')
    .map((o) => Number(o.set?.points))
    .filter((p) => Number.isFinite(p) && p >= 0)
  if (hero.length) {
    const result = await HeroModel.collection.findOneAndUpdate(
      { user: user._id },
      {
        $max: { points: Math.max(...hero) },
        $set: { updatedAt: new Date(now) },
        $setOnInsert: { createdAt: new Date(now) },
      },
      { upsert: true, returnOriginal: false }
    )
    acks.push({ c: 'hero', u: now, fix: { points: result.value?.points } })
  }
  const name = of('user')
    .map((o) => o.set?.name)
    .filter((n): n is string => typeof n === 'string' && !!n.trim())
    .pop()
  if (name) {
    await UserModel.collection.updateOne(
      { _id: user._id },
      { $set: { name: name.trim().slice(0, 250), updatedAt: new Date(now) } }
    )
    acks.push({ c: 'user', u: now })
  }
  if (acks.some((a) => a.u && a.c !== 'todo' && a.c !== 'tag'))
    publish(userId, { t: 'pull' }, origin)
  notifyLegacy([userId, ...counterparts])
  return acks
}

/** v1 clients (socket.io) learn about v2 writes the same way they learn about each other's */
function notifyLegacy(users: string[]) {
  // Required lazily: sockets/index imports the models, which import this module's plugin
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requestLegacySync } = require('@/sockets')
  for (const user of new Set(users)) requestLegacySync(user)
}
