import * as Router from 'koa-router'
import * as randToken from 'rand-token'
import { Context, Next } from 'koa'
import { HeroModel } from '@/models/hero'
import { ObjectId } from 'mongodb'
import { Op, pull, push } from '@/v2/sync'
import { QrLoginModel } from '@/models/QrLoginModel'
import { ReportModel } from '@/models/report'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { UserModel } from '@/models/user'
import { authenticate, spend, tokenOf } from '@/v2/auth'
import { hint, kick } from '@/v2/hub'
import { isObjectId } from '@/v2/schema'
import { passwordRoutes } from '@/v2/password'
import { wire } from '@/v2/wire'

/** /v2: lean JSON over the same data and write path as sync; old endpoints stay untouched */
export const v2 = new Router({ prefix: '/v2' })

// JSON errors with the right status (the v1 controller framework turns non-Boom errors into 500s)
v2.use(async (ctx, next) => {
  try {
    await next()
  } catch (error) {
    // v1 handlers behind /v2/auth throw Boom errors: their status is in `output`
    const { status, output } = error as {
      status?: number
      output?: { statusCode?: number }
    }
    const code = status || output?.statusCode || 500
    ctx.status = code
    ctx.body = {
      error: code < 500 ? (error as Error).message : 'Internal Server Error',
    }
    if (code >= 500) console.error(error)
  }
})

const uid = (ctx: Context) => new ObjectId(ctx.state.uid as string)

async function auth(ctx: Context, next: Next) {
  const id = await authenticate(tokenOf(ctx.headers))
  if (!id) ctx.throw(401, 'Unauthorized')
  if (!spend(id, 1)) ctx.throw(429, 'Too many requests')
  ctx.state.uid = id
  await next()
}

const ops = (ctx: Context, list: Op[]) => push(ctx.state.uid, list)

/** Writes through sync; responds with the ack (409 when a field lost to a newer write, 400 on errors) */
async function write(ctx: Context, op: Op) {
  const [ack] = await ops(ctx, [op])
  if (!ack) ctx.throw(400, 'Invalid fields')
  if (ack.e) ctx.throw(ack.e === 'Not found' ? 404 : 400, ack.e)
  ctx.body = ack
}

// Email + password accounts (before the alias below, which would send them to v1)
passwordRoutes(v2)

// Login lives in the v1 controllers (OAuth flows); /v2/auth/* is the same handlers under v2
v2.post('/auth/:provider', (ctx, next) => {
  ctx.path = `/login/${ctx.params.provider}`
  // koa-router routes by ctx.routerPath before ctx.path; let the v1 router match the rewritten path
  ctx.routerPath = undefined
  return next()
})

// Sync over HTTP: `{since?, ops?}` → `{acks?, cursor, todos, tags, …}` (widgets, one-shot clients)
v2.post('/sync', auth, async (ctx) => {
  const { since, ops: list } = ctx.request.body as {
    since?: number
    ops?: Op[]
  }
  if (since !== undefined && !Number.isFinite(since))
    ctx.throw(400, 'Invalid since')
  const acks = list?.length ? await push(ctx.state.uid, list) : undefined
  ctx.body = {
    acks,
    ...(since !== undefined
      ? await pull(ctx.state.uid, since || undefined)
      : {}),
  }
})

const visible = {
  deleted: false,
  $or: [{ delegator: null }, { delegateAccepted: true }],
}

/** Today's first todo and counts: two indexed counts and one indexed lookup */
v2.get('/todos/current', auth, async (ctx) => {
  const day = String(ctx.query.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    ctx.throw(400, 'date must be YYYY-MM-DD')
  const filter = {
    user: uid(ctx),
    monthAndYear: day.slice(0, 7),
    date: day.slice(8),
    ...visible,
  }
  const [total, incomplete, [todo]] = await Promise.all([
    TodoModel.collection.countDocuments(filter),
    TodoModel.collection.countDocuments({ ...filter, completed: false }),
    TodoModel.collection
      .find({ ...filter, completed: false })
      .sort({ frog: -1, order: 1 })
      .limit(1)
      .toArray(),
  ])
  ctx.body = { total, incomplete, todo: todo && wire('todo', todo) }
})

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Planning/completed lists sorted by day, frogs first, then order; paginated in the database */
v2.get('/todos', auth, async (ctx) => {
  const completed = ctx.query.completed === 'true'
  const filter: Record<string, unknown> = {
    user: uid(ctx),
    completed,
    ...visible,
  }
  const search = [
    String(ctx.query.q || ''),
    ...String(ctx.query.hash || '').split(','),
  ].filter(Boolean)
  if (search.length > 20 || search.some((s) => s.length > 100))
    ctx.throw(400, 'Search is too long')
  if (search.length)
    filter.$and = search.map((s) => ({
      text: { $regex: escape(s), $options: 'i' },
    }))
  const dir = completed ? -1 : 1
  const limit = Math.min(Number(ctx.query.limit) || 50, 500)
  const skip = Math.max(Number(ctx.query.skip) || 0, 0)
  const todos = await TodoModel.collection
    .find(filter, { projection: { _fts: 0, __v: 0, clientId: 0 } })
    .sort({ monthAndYear: dir, date: dir, frog: -1, order: 1 })
    .skip(skip)
    .limit(limit)
    .toArray()
  ctx.body = { todos: todos.map((t) => wire('todo', t)) }
})

v2.post('/todos', auth, async (ctx) => {
  const body = ctx.request.body as Record<string, any>
  const list = (Array.isArray(body) ? body : [body]).map((t) => ({
    c: 'todo' as const,
    id: isObjectId(t?.id) ? t.id : new ObjectId().toHexString(),
    at: Date.now(),
    set: t,
  }))
  const acks = await ops(ctx, list)
  if (acks.every((a) => a.e)) ctx.throw(400, acks[0]?.e || 'Invalid todos')
  ctx.body = { acks }
})
v2.patch('/todos/:id', auth, (ctx) =>
  write(ctx, {
    c: 'todo',
    id: ctx.params.id,
    at: Date.now(),
    set: ctx.request.body as never,
  })
)
v2.delete('/todos/:id', auth, (ctx) =>
  write(ctx, {
    c: 'todo',
    id: ctx.params.id,
    at: Date.now(),
    set: { deleted: true },
  })
)

v2.get('/tags', auth, async (ctx) => {
  const tags = await TagModel.collection
    .find(
      { user: uid(ctx), deleted: false },
      { projection: { _fts: 0, __v: 0, clientId: 0 } }
    )
    .sort({ epic: -1, epicOrder: 1, numberOfUses: -1, tag: 1 })
    .toArray()
  ctx.body = { tags: tags.map((t) => wire('tag', t)) }
})
v2.patch('/tags/:id', auth, (ctx) =>
  write(ctx, {
    c: 'tag',
    id: ctx.params.id,
    at: Date.now(),
    set: ctx.request.body as never,
  })
)

v2.patch('/settings', auth, (ctx) =>
  write(ctx, { c: 'settings', at: Date.now(), set: ctx.request.body as never })
)
v2.patch('/me', auth, (ctx) =>
  write(ctx, { c: 'user', at: Date.now(), set: ctx.request.body as never })
)

// Delegation commands — writes that touch two users, so they aren't ops. Only actual changes notify
// the other user's devices: anyone can name anyone's id here.
async function touched(...users: unknown[]) {
  const now = new Date()
  await UserModel.collection.updateMany(
    { _id: { $in: users } },
    { $set: { delegatesUpdatedAt: now } }
  )
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requestLegacySync } = require('@/sockets')
  for (const user of users) {
    hint(user)
    requestLegacySync(String(user))
  }
}

/** Become a delegate of the owner of an invite token */
v2.post('/delegation/accept', auth, async (ctx) => {
  const token = String(
    (ctx.request.body as Record<string, unknown>).token || ''
  )
  const delegator =
    token &&
    (await UserModel.collection.findOne(
      { delegateInviteToken: token },
      { projection: { _id: 1, name: 1 } }
    ))
  if (!delegator || String(delegator._id) === ctx.state.uid)
    ctx.throw(404, 'Invalid invite')
  const { modifiedCount } = await UserModel.collection.updateOne(
    { _id: delegator._id },
    { $addToSet: { delegates: uid(ctx) } }
  )
  if (modifiedCount) await touched(delegator._id, uid(ctx))
  ctx.body = { id: String(delegator._id), name: delegator.name }
})
v2.delete('/delegation/delegates/:id', auth, async (ctx) => {
  if (!isObjectId(ctx.params.id)) ctx.throw(400, 'Invalid id')
  const other = new ObjectId(ctx.params.id)
  const { modifiedCount } = await UserModel.collection.updateOne(
    { _id: uid(ctx) },
    { $pull: { delegates: other } }
  )
  if (modifiedCount) await touched(uid(ctx), other)
  ctx.status = 204
})
v2.delete('/delegation/delegators/:id', auth, async (ctx) => {
  if (!isObjectId(ctx.params.id)) ctx.throw(400, 'Invalid id')
  const other = new ObjectId(ctx.params.id)
  const { modifiedCount } = await UserModel.collection.updateOne(
    { _id: other },
    { $pull: { delegates: uid(ctx) } }
  )
  if (modifiedCount) await touched(uid(ctx), other)
  ctx.status = 204
})
v2.post('/delegation/token', auth, async (ctx) => {
  const token = randToken.generate(16)
  await UserModel.collection.updateOne(
    { _id: uid(ctx) },
    { $set: { delegateInviteToken: token, updatedAt: new Date() } }
  )
  hint(ctx.state.uid)
  ctx.body = { token }
})

/**
 * Deletes the account for good with its todos, hashtags, hero, reports and QR logins, and unlinks it from
 * delegation. Todos it delegated that were accepted stay with their delegates as their own; what the
 * other side still lists (pending delegations, todos delegated to it) becomes a tombstone their devices
 * drop on the next pull.
 */
v2.delete('/account', auth, async (ctx) => {
  const id = uid(ctx)
  const user = await UserModel.collection.findOne({ _id: id })
  if (!user) return ctx.throw(401, 'Unauthorized')
  const [delegators, toThem, fromThem] = await Promise.all([
    UserModel.collection.distinct('_id', { delegates: id }),
    TodoModel.collection.distinct('user', { delegator: id }),
    TodoModel.collection.distinct('delegator', {
      user: id,
      delegator: { $ne: null },
    }),
  ])
  const now = new Date()
  const tombstone = { deleted: true, text: '', updatedAt: now }
  await Promise.all([
    TodoModel.collection.deleteMany({ user: id, delegator: null }),
    TodoModel.collection.updateMany(
      { user: id, delegator: { $ne: null } },
      { $set: tombstone }
    ),
    TodoModel.collection.updateMany(
      { delegator: id, delegateAccepted: true },
      { $set: { delegator: null, updatedAt: now } }
    ),
    TodoModel.collection.updateMany(
      { delegator: id, delegateAccepted: { $ne: true } },
      { $set: { ...tombstone, delegator: null } }
    ),
    TagModel.collection.deleteMany({ user: id }),
    HeroModel.collection.deleteMany({ user: id }),
    ReportModel.collection.deleteMany({ user: id }),
    QrLoginModel.collection.deleteMany({ token: user.token }),
    UserModel.collection.updateMany(
      { delegates: id },
      { $pull: { delegates: id } }
    ),
  ])
  // Last, so a failure above leaves an account its owner can delete again. Then its token resolves to
  // nobody: its devices can't write or reconnect
  await UserModel.collection.deleteOne({ _id: id })
  kick(id)
  const others = [
    ...(user.delegates || []),
    ...delegators,
    ...toThem,
    ...fromThem,
  ]
  await touched(...new Map(others.map((o) => [String(o), o])).values())
  ctx.status = 204
})
