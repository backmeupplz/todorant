import * as WebSocket from 'ws'
import * as request from 'supertest'
import { AddressInfo } from 'net'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ObjectId } from 'mongodb'
import { Server } from 'http'
import { TodoModel } from '@/models/todo'
import { UserModel } from '@/models/user'
import { app } from '@/app'
import { attachWebSocket } from '@/v2/ws'
import { dropMongo, startKoa, stopServer } from '@/__tests__/testUtils'
import { ensureIndexes } from '@/v2/indexes'
import { runMongo, stopMongo } from '@/models/index'
import { sign } from '@/helpers/jwt'

jest.setTimeout(20000)

const id = () => new ObjectId().toHexString()
const day = { monthAndYear: '2026-10', date: '13' }

describe('v2 sync and API', () => {
  let server: Server
  let a: { token: string; _id: string }
  let b: { token: string; _id: string }
  const sync = (token: string, body: unknown) =>
    request(server).post('/v2/sync').set('authorization', `Bearer ${token}`).send(body).expect(200).then((r) => r.body)

  async function user(email: string) {
    const token = await sign({ email })
    const doc = await UserModel.create({ name: email, email, token })
    return { token, _id: String(doc._id) }
  }

  function socket(token: string) {
    const ws = new WebSocket(`ws://localhost:${(server.address() as AddressInfo).port}/v2/ws?token=${token}`)
    const messages: any[] = []
    ws.on('message', (data) => messages.push(JSON.parse(String(data))))
    const until = async (test: (m: any) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const found = messages.find(test)
        if (found) return found
        await new Promise((r) => setTimeout(r, 20))
      }
      throw new Error('No such message')
    }
    return { ws, messages, until, ready: until((m) => m.t === 'hello') }
  }

  beforeAll(async () => {
    const mongo = new MongoMemoryServer()
    await runMongo(await mongo.getUri())
    server = await startKoa(app)
    attachWebSocket(server)
  })
  beforeEach(async () => {
    await dropMongo()
    await ensureIndexes()
    a = await user('a@todorant.com')
    b = await user('b@todorant.com')
  })
  afterAll(async () => {
    await stopMongo()
    await stopServer(server)
  })

  it('pulls a full snapshot, then only the delta', async () => {
    // Users created long ago: a delta shouldn't carry them (pulls re-send the last few seconds)
    const old = new Date(0)
    await UserModel.collection.updateMany({}, { $set: { updatedAt: old, delegatesUpdatedAt: old } })
    const full = await sync(a.token, { since: 0 })
    expect(full.todos).toEqual([])
    expect(full.user.name).toBe('a@todorant.com')
    expect(full.delegation).toEqual({ delegates: [], delegators: [] })
    const todo = id()
    const { acks } = await sync(a.token, { ops: [{ c: 'todo', id: todo, at: Date.now(), set: { text: 'one', ...day } }] })
    expect(acks).toEqual([{ c: 'todo', id: todo, u: expect.any(Number) }])
    const delta = await sync(a.token, { since: full.cursor })
    expect(delta.todos.map((t: any) => t.id)).toEqual([todo])
    expect(delta.todos[0]).toMatchObject({ text: 'one', completed: false, order: 0, user: a._id })
    expect(delta.user).toBeUndefined()
    expect(delta.delegation).toBeUndefined()
  })

  it('resolves conflicts per field by edit time and reports lost fields', async () => {
    const todo = id()
    const t = Date.now() - 1000
    await sync(a.token, { ops: [{ c: 'todo', id: todo, at: t, set: { text: 'v0', ...day } }] })
    await sync(a.token, { ops: [{ c: 'todo', id: todo, at: t + 20, set: { text: 'newer' } }] })
    const { acks } = await sync(a.token, { ops: [{ c: 'todo', id: todo, at: t + 10, set: { text: 'older', frog: true } }] })
    expect(acks[0].fix).toEqual({ text: 'newer' })
    const doc = await TodoModel.findById(todo)
    expect(doc!.text).toBe('newer')
    expect(doc!.frog).toBe(true)
  })

  it('clamps edit times from the future', async () => {
    const todo = id()
    await sync(a.token, { ops: [{ c: 'todo', id: todo, at: Date.now() + 1e9, set: { text: 'skewed clock', ...day } }] })
    await new Promise((r) => setTimeout(r, 5))
    await sync(a.token, { ops: [{ c: 'todo', id: todo, at: Date.now(), set: { text: 'later' } }] })
    expect((await TodoModel.findById(todo))!.text).toBe('later')
  })

  it("respects v1 writes and keeps other users' todos private", async () => {
    const todo = await TodoModel.create({ user: a._id, text: 'v1', ...day })
    expect((todo as any)._fts.text).toBeGreaterThan(0)
    const { acks } = await sync(a.token, { ops: [{ c: 'todo', id: String(todo._id), at: Date.now() - 60000, set: { text: 'stale' } }] })
    expect(acks[0].fix).toEqual({ text: 'v1' })
    const other = await sync(b.token, { ops: [{ c: 'todo', id: String(todo._id), at: Date.now(), set: { text: 'hack' } }], since: 0 })
    expect(other.acks[0].e).toBe('Not found')
    expect(other.todos).toEqual([])
    // v1 clients never see the v2 bookkeeping
    const v1 = await request(server).get('/todo/current?date=2026-10-13').set('token', a.token).expect(200)
    expect(v1.body.todo.text).toBe('v1')
    expect(JSON.stringify(v1.body)).not.toContain('_fts')
  })

  it('validates input', async () => {
    const { acks } = await sync(a.token, {
      ops: [
        { c: 'todo', id: 'nope', at: Date.now(), set: { text: 'x' } },
        { c: 'todo', id: id(), at: Date.now(), set: { text: 'no date' } },
        { c: 'todo', id: id(), at: Date.now(), set: { text: 1, ...day } },
        { c: 'todo', id: id(), at: Date.now(), set: { text: 'bad month', monthAndYear: 'soon' } },
      ],
    })
    expect(acks.map((x: any) => x.e)).toEqual(['Invalid id', 'monthAndYear is required', 'Invalid text', 'Invalid monthAndYear'])
    await request(server).post('/v2/sync').send({ since: 0 }).expect(401)
    // v2 aliases of the v1 logins
    const login = await request(server).post('/v2/auth/token').send({ token: a.token }).expect(200)
    expect(login.body._id).toBe(a._id)
  })

  it('delegates todos to delegates only and locks them for the delegator once accepted', async () => {
    const todo = id()
    const op = { c: 'todo', id: todo, at: Date.now(), set: { text: 'for b', ...day, user: b._id, delegator: a._id } }
    expect((await sync(a.token, { ops: [op] })).acks[0].e).toBe('Invalid delegation')
    await request(server).post('/v2/delegation/accept').set('authorization', `Bearer ${b.token}`)
      .send({ token: (await UserModel.findById(a._id))!.delegateInviteToken }).expect(200)
    expect((await sync(b.token, { since: 0 })).delegation.delegators).toEqual([{ id: a._id, name: 'a@todorant.com' }])
    expect((await sync(a.token, { ops: [op] })).acks[0].e).toBeUndefined()
    const pulled = await sync(b.token, { since: 0 })
    expect(pulled.todos[0]).toMatchObject({ id: todo, user: b._id, delegator: a._id, delegateAccepted: false })
    await sync(b.token, { ops: [{ c: 'todo', id: todo, at: Date.now(), set: { delegateAccepted: true } }] })
    const { acks } = await sync(a.token, { ops: [{ c: 'todo', id: todo, at: Date.now() + 1, set: { text: 'changed' } }] })
    expect(acks[0].fix).toEqual({ text: 'for b' })
    await request(server).delete(`/v2/delegation/delegators/${a._id}`).set('authorization', `Bearer ${b.token}`).expect(204)
    expect((await sync(a.token, { since: 0 })).delegation.delegates).toEqual([])
  })

  it('merges settings per field, including newer v1 writes, and keeps the highest hero score', async () => {
    const t = Date.now() - 1000
    await sync(a.token, { ops: [{ c: 'settings', at: t, set: { firstDayOfWeek: 1, language: 'ru' } }] })
    await sync(a.token, { ops: [{ c: 'settings', at: t + 10, set: { language: 'en' } }] })
    const { acks } = await sync(a.token, { ops: [{ c: 'settings', at: t + 5, set: { language: 'it', newTodosGoFirst: true } }] })
    expect(acks[0].fix).toEqual({ language: 'en' })
    let settings = (await UserModel.findById(a._id))!.settings
    expect(settings).toMatchObject({ firstDayOfWeek: 1, language: 'en', newTodosGoFirst: true })
    await new Promise((r) => setTimeout(r, 5))
    await UserModel.updateOne({ _id: a._id }, { $set: { 'settings.language': 'uk', 'settings.updatedAt': new Date() } })
    await sync(a.token, { ops: [{ c: 'settings', at: t + 20, set: { language: 'es' } }] })
    settings = (await UserModel.findById(a._id))!.settings
    expect(settings.language).toBe('uk')
    await sync(a.token, { ops: [{ c: 'hero', at: t, set: { points: 10 } }] })
    const hero = await sync(a.token, { ops: [{ c: 'hero', at: t, set: { points: 3 } }], since: 0 })
    expect(hero.acks[0].fix.points).toBe(10)
    expect(hero.hero.points).toBe(10)
  })

  it('pushes changes to the other devices in real time', async () => {
    const one = socket(a.token)
    const two = socket(a.token)
    const delegate = socket(b.token)
    await Promise.all([one.ready, two.ready, delegate.ready])
    const todo = id()
    one.ws.send(JSON.stringify({ t: 'sync', rid: 1, ops: [{ c: 'todo', id: todo, at: Date.now(), set: { text: 'live', ...day } }] }))
    await one.until((m) => m.t === 'synced' && m.rid === 1)
    const change = await two.until((m) => m.t === 'changes')
    expect(change.todos[0]).toMatchObject({ id: todo, text: 'live' })
    one.ws.send(JSON.stringify({ t: 'sync', rid: 2, ops: [{ c: 'todo', id: todo, at: Date.now(), set: { completed: true } }] }))
    await one.until((m) => m.rid === 2)
    // Only the changed field travels
    const partial = await two.until((m) => m.t === 'changes' && m.todos[0].completed)
    expect(Object.keys(partial.todos[0]).sort()).toEqual(['completed', 'id', 'updatedAt'])
    // The sender doesn't get its own changes back, and other users get nothing
    expect(one.messages.filter((m) => m.t === 'changes')).toEqual([])
    expect(delegate.messages.filter((m) => m.t === 'changes')).toEqual([])
    // v1 writes reach v2 devices too
    await request(server).post('/todo').set('token', a.token).send({ text: 'from v1', completed: false, frog: false, ...day }).expect(204)
    expect((await one.until((m) => m.t === 'changes' && m.todos[0].text === 'from v1')).todos[0].user).toBe(a._id)
    for (const s of [one, two, delegate]) s.ws.close()
  })

  it('serves current and paginated lists from the database', async () => {
    const t = Date.now()
    const set = (text: string, extra: Record<string, unknown>) => ({ c: 'todo', id: id(), at: t, set: { text, ...extra } })
    await sync(a.token, {
      ops: [
        set('second', { ...day, order: 1 }),
        set('frog', { ...day, order: 5, frog: true }),
        set('done', { ...day, completed: true }),
        set('tomorrow', { monthAndYear: '2026-10', date: '14' }),
        set('month', { monthAndYear: '2026-10' }),
        set('gone', { ...day, deleted: true }),
      ],
    })
    const auth = { authorization: `Bearer ${a.token}` }
    const current = await request(server).get('/v2/todos/current?date=2026-10-13').set(auth).expect(200)
    expect(current.body).toMatchObject({ total: 3, incomplete: 2, todo: { text: 'frog' } })
    const list = await request(server).get('/v2/todos').set(auth).expect(200)
    expect(list.body.todos.map((x: any) => x.text)).toEqual(['month', 'frog', 'second', 'tomorrow'])
    const page = await request(server).get('/v2/todos?skip=1&limit=2&q=o').set(auth).expect(200)
    expect(page.body.todos.map((x: any) => x.text)).toEqual(['frog', 'second'])
    await request(server).patch(`/v2/todos/${list.body.todos[0].id}`).set(auth).send({ completed: true }).expect(200)
    const completed = await request(server).get('/v2/todos?completed=true').set(auth).expect(200)
    // Newest day first; a month-only todo sorts after that month's days (v1 put it first)
    expect(completed.body.todos.map((x: any) => x.text)).toEqual(['done', 'month'])
  })
})
