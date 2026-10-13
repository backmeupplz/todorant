import * as Router from 'koa-router'
import * as randToken from 'rand-token'
import { Context, Next } from 'koa'
import { ObjectId } from 'mongodb'
import { Op, pull, push } from '@/v2/sync'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { UserModel } from '@/models/user'
import { authenticate, tokenOf } from '@/v2/auth'
import { hint } from '@/v2/hub'
import { isObjectId } from '@/v2/schema'
import { wire } from '@/v2/wire'

/** /v2: lean JSON over the same data and write path as sync; old endpoints stay untouched */
export const v2 = new Router({ prefix: '/v2' })

// JSON errors with the right status (the v1 controller framework turns non-Boom errors into 500s)
v2.use(async (ctx, next) => {
  try {
    await next()
  } catch (error) {
    const status = (error as { status?: number }).status || 500
    ctx.status = status
    ctx.body = {
      error: status < 500 ? (error as Error).message : 'Internal Server Error',
    }
    if (status >= 500) console.error(error)
  }
})

const uid = (ctx: Context) => new ObjectId(ctx.state.uid as string)

async function auth(ctx: Context, next: Next) {
  const id = await authenticate(tokenOf(ctx.headers, ctx.url))
  if (!id) ctx.throw(401, 'Unauthorized')
  ctx.state.uid = id
  await next()
}

const ops = (ctx: Context, list: Op[]) =>
  push(ctx.state.uid, list, undefined, ctx.get('password') || undefined)

/** Writes through sync; responds with the ack (409 when a field lost to a newer write, 400 on errors) */
async function write(ctx: Context, op: Op) {
  const [ack] = await ops(ctx, [op])
  if (ack.e) ctx.throw(ack.e === 'Not found' ? 404 : 400, ack.e)
  ctx.body = ack
}

// Login lives in the v1 controllers (OAuth flows); /v2/auth/* is the same handlers under v2
v2.post('/auth/:provider', (ctx, next) => {
  ctx.path = `/login/${ctx.params.provider}`
  // koa-router routes by ctx.routerPath before ctx.path; let the v1 router match the rewritten path
  ctx.routerPath = undefined
  return next()
})

// Sync over HTTP: `{since?, ops?}` → `{acks?, cursor, todos, tags, …}` (widgets, one-shot clients)
v2.post('/sync', auth, async (ctx) => {
  const {
    since,
    ops: list,
    key,
  } = ctx.request.body as { since?: number; ops?: Op[]; key?: string }
  const acks = list?.length
    ? await push(ctx.state.uid, list, undefined, key)
    : undefined
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
    id: isObjectId(t.id) ? t.id : new ObjectId().toHexString(),
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

// Delegation commands — writes that touch two users, so they aren't ops
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
  await UserModel.collection.updateOne(
    { _id: delegator._id },
    { $addToSet: { delegates: uid(ctx) } }
  )
  await touched(delegator._id, uid(ctx))
  ctx.body = { id: String(delegator._id), name: delegator.name }
})
v2.delete('/delegation/delegates/:id', auth, async (ctx) => {
  if (!isObjectId(ctx.params.id)) ctx.throw(400, 'Invalid id')
  const other = new ObjectId(ctx.params.id)
  await UserModel.collection.updateOne(
    { _id: uid(ctx) },
    { $pull: { delegates: other } }
  )
  await touched(uid(ctx), other)
  ctx.status = 204
})
v2.delete('/delegation/delegators/:id', auth, async (ctx) => {
  if (!isObjectId(ctx.params.id)) ctx.throw(400, 'Invalid id')
  const other = new ObjectId(ctx.params.id)
  await UserModel.collection.updateOne(
    { _id: other },
    { $pull: { delegates: uid(ctx) } }
  )
  await touched(uid(ctx), other)
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
