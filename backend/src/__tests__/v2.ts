/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as WebSocket from 'ws'
import * as jwt from 'jsonwebtoken'
import * as randToken from 'rand-token'
import * as request from 'supertest'
import { AddressInfo } from 'net'
import { HeroModel } from '@/models/hero'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ObjectId } from 'mongodb'
import { Server } from 'http'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { URL } from 'url'
import { UserModel } from '@/models/user'
import { app } from '@/app'
import { attachWebSocket } from '@/v2/ws'
import { createHash, createHmac, generateKeyPairSync } from 'crypto'
import {
  dropMongo,
  facebookApiSpy,
  startKoa,
  stopServer,
} from '@/__tests__/testUtils'
import { ensureIndexes } from '@/v2/indexes'
import { runMongo, stopMongo } from '@/models/index'
import { sign, verify } from '@/helpers/jwt'
import { spend } from '@/v2/auth'
import MockAdapter from 'axios-mock-adapter'
import axios from 'axios'

jest.setTimeout(20000)

// Apple's signing keys, without the network
const mockApple = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
jest.mock('jwks-rsa', () => () => ({
  getSigningKey: (_: string, done: (e: null, key: unknown) => void) =>
    done(null, { publicKey: mockApple.publicKey }),
}))
const WEB_CLIENT =
  '989382323327-rou6lmk2umbnoaq55493v1kqm8fvp22q.apps.googleusercontent.com'

const id = () => new ObjectId().toHexString()
const day = { monthAndYear: '2026-10', date: '13' }

describe('v2 sync and API', () => {
  let server: Server
  let a: { token: string; _id: string }
  let b: { token: string; _id: string }
  const sync = (token: string, body: unknown) =>
    request(server)
      .post('/v2/sync')
      .set('authorization', `Bearer ${token}`)
      .send(body)
      .expect(200)
      .then((r) => r.body)

  async function user(email: string) {
    const token = await sign({ email })
    const doc = await UserModel.create({
      name: email,
      email,
      token,
      delegateInviteToken: randToken.generate(16),
    })
    return { token, _id: String(doc._id) }
  }

  const url = () => `ws://localhost:${(server.address() as AddressInfo).port}`

  function socket(
    token: string,
    connect = (base: string) => new WebSocket(`${base}/v2/ws?token=${token}`)
  ) {
    const ws = connect(url())
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
  const axiosMock = new MockAdapter(axios)
  afterAll(async () => {
    axiosMock.restore()
    await stopMongo()
    await stopServer(server)
  })
  const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms))

  it('pulls a full snapshot, then only the delta', async () => {
    // Users created long ago: a delta shouldn't carry them (pulls re-send the last few seconds)
    const old = new Date(0)
    await UserModel.collection.updateMany(
      {},
      { $set: { updatedAt: old, delegatesUpdatedAt: old } }
    )
    const full = await sync(a.token, { since: 0 })
    expect(full.todos).toEqual([])
    expect(full.user.name).toBe('a@todorant.com')
    expect(full.delegation).toEqual({ delegates: [], delegators: [] })
    const todo = id()
    const { acks } = await sync(a.token, {
      ops: [
        { c: 'todo', id: todo, at: Date.now(), set: { text: 'one', ...day } },
      ],
    })
    expect(acks).toEqual([{ c: 'todo', id: todo, u: expect.any(Number) }])
    const delta = await sync(a.token, { since: full.cursor })
    expect(delta.todos.map((t: any) => t.id)).toEqual([todo])
    expect(delta.todos[0]).toMatchObject({
      text: 'one',
      completed: false,
      order: 0,
      user: a._id,
    })
    expect(delta.user).toBeUndefined()
    expect(delta.delegation).toBeUndefined()
  })

  it('resolves conflicts per field by edit time and reports lost fields', async () => {
    const todo = id()
    const t = Date.now() - 1000
    await sync(a.token, {
      ops: [{ c: 'todo', id: todo, at: t, set: { text: 'v0', ...day } }],
    })
    await sync(a.token, {
      ops: [{ c: 'todo', id: todo, at: t + 20, set: { text: 'newer' } }],
    })
    const { acks } = await sync(a.token, {
      ops: [
        { c: 'todo', id: todo, at: t + 10, set: { text: 'older', frog: true } },
      ],
    })
    expect(acks[0].fix).toEqual({ text: 'newer' })
    const doc = await TodoModel.findById(todo)
    expect(doc!.text).toBe('newer')
    expect(doc!.frog).toBe(true)
  })

  it('clamps edit times from the future', async () => {
    const todo = id()
    await sync(a.token, {
      ops: [
        {
          c: 'todo',
          id: todo,
          at: Date.now() + 1e9,
          set: { text: 'skewed clock', ...day },
        },
      ],
    })
    await new Promise((r) => setTimeout(r, 5))
    await sync(a.token, {
      ops: [{ c: 'todo', id: todo, at: Date.now(), set: { text: 'later' } }],
    })
    expect((await TodoModel.findById(todo))!.text).toBe('later')
  })

  it("respects v1 writes and keeps other users' todos private", async () => {
    const todo = await TodoModel.create({ user: a._id, text: 'v1', ...day })
    expect((todo as any)._fts.text).toBeGreaterThan(0)
    const { acks } = await sync(a.token, {
      ops: [
        {
          c: 'todo',
          id: String(todo._id),
          at: Date.now() - 60000,
          set: { text: 'stale' },
        },
      ],
    })
    expect(acks[0].fix).toEqual({ text: 'v1' })
    const other = await sync(b.token, {
      ops: [
        {
          c: 'todo',
          id: String(todo._id),
          at: Date.now(),
          set: { text: 'hack' },
        },
      ],
      since: 0,
    })
    expect(other.acks[0].e).toBe('Not found')
    expect(other.todos).toEqual([])
    // v1 clients never see the v2 bookkeeping
    const v1 = await request(server)
      .get('/todo/current?date=2026-10-13')
      .set('token', a.token)
      .expect(200)
    expect(v1.body.todo.text).toBe('v1')
    expect(JSON.stringify(v1.body)).not.toContain('_fts')
  })

  it('validates input', async () => {
    const { acks } = await sync(a.token, {
      ops: [
        { c: 'todo', id: 'nope', at: Date.now(), set: { text: 'x' } },
        { c: 'todo', id: id(), at: Date.now(), set: { text: 'no date' } },
        { c: 'todo', id: id(), at: Date.now(), set: { text: 1, ...day } },
        {
          c: 'todo',
          id: id(),
          at: Date.now(),
          set: { text: 'bad month', monthAndYear: 'soon' },
        },
      ],
    })
    expect(acks.map((x: any) => x.e)).toEqual([
      'Invalid id',
      'monthAndYear is required',
      'Invalid text',
      'Invalid monthAndYear',
    ])
    await request(server).post('/v2/sync').send({ since: 0 }).expect(401)
    // v2 aliases of the v1 logins
    const login = await request(server)
      .post('/v2/auth/token')
      .send({ token: a.token })
      .expect(200)
    expect(login.body._id).toBe(a._id)
  })

  it('delegates todos to delegates only and locks them for the delegator once accepted', async () => {
    const todo = id()
    const op = {
      c: 'todo',
      id: todo,
      at: Date.now(),
      set: { text: 'for b', ...day, user: b._id, delegator: a._id },
    }
    expect((await sync(a.token, { ops: [op] })).acks[0].e).toBe(
      'Invalid delegation'
    )
    await request(server)
      .post('/v2/delegation/accept')
      .set('authorization', `Bearer ${b.token}`)
      .send({ token: (await UserModel.findById(a._id))!.delegateInviteToken })
      .expect(200)
    expect((await sync(b.token, { since: 0 })).delegation.delegators).toEqual([
      { id: a._id, name: 'a@todorant.com' },
    ])
    expect((await sync(a.token, { ops: [op] })).acks[0].e).toBeUndefined()
    const pulled = await sync(b.token, { since: 0 })
    expect(pulled.todos[0]).toMatchObject({
      id: todo,
      user: b._id,
      delegator: a._id,
      delegateAccepted: false,
    })
    await sync(b.token, {
      ops: [
        {
          c: 'todo',
          id: todo,
          at: Date.now(),
          set: { delegateAccepted: true },
        },
      ],
    })
    const { acks } = await sync(a.token, {
      ops: [
        { c: 'todo', id: todo, at: Date.now() + 1, set: { text: 'changed' } },
      ],
    })
    expect(acks[0].fix).toEqual({ text: 'for b' })
    await request(server)
      .delete(`/v2/delegation/delegators/${a._id}`)
      .set('authorization', `Bearer ${b.token}`)
      .expect(204)
    expect((await sync(a.token, { since: 0 })).delegation.delegates).toEqual([])
  })

  it('merges settings per field, including newer v1 writes, and keeps the highest hero score', async () => {
    const t = Date.now() - 1000
    await sync(a.token, {
      ops: [
        { c: 'settings', at: t, set: { firstDayOfWeek: 1, language: 'ru' } },
      ],
    })
    await sync(a.token, {
      ops: [{ c: 'settings', at: t + 10, set: { language: 'en' } }],
    })
    const { acks } = await sync(a.token, {
      ops: [
        {
          c: 'settings',
          at: t + 5,
          set: { language: 'it', newTodosGoFirst: true },
        },
      ],
    })
    expect(acks[0].fix).toEqual({ language: 'en' })
    let settings = (await UserModel.findById(a._id))!.settings
    expect(settings).toMatchObject({
      firstDayOfWeek: 1,
      language: 'en',
      newTodosGoFirst: true,
    })
    await new Promise((r) => setTimeout(r, 5))
    await UserModel.updateOne(
      { _id: a._id },
      { $set: { 'settings.language': 'uk', 'settings.updatedAt': new Date() } }
    )
    await sync(a.token, {
      ops: [{ c: 'settings', at: t + 20, set: { language: 'es' } }],
    })
    settings = (await UserModel.findById(a._id))!.settings
    expect(settings.language).toBe('uk')
    await sync(a.token, { ops: [{ c: 'hero', at: t, set: { points: 10 } }] })
    const hero = await sync(a.token, {
      ops: [{ c: 'hero', at: t, set: { points: 3 } }],
      since: 0,
    })
    expect(hero.acks[0].fix.points).toBe(10)
    expect(hero.hero.points).toBe(10)
  })

  it('pushes changes to the other devices in real time', async () => {
    const one = socket(a.token)
    const two = socket(a.token)
    const delegate = socket(b.token)
    await Promise.all([one.ready, two.ready, delegate.ready])
    const todo = id()
    one.ws.send(
      JSON.stringify({
        t: 'sync',
        rid: 1,
        ops: [
          {
            c: 'todo',
            id: todo,
            at: Date.now(),
            set: { text: 'live', ...day },
          },
        ],
      })
    )
    await one.until((m) => m.t === 'synced' && m.rid === 1)
    const change = await two.until((m) => m.t === 'changes')
    expect(change.todos[0]).toMatchObject({ id: todo, text: 'live' })
    one.ws.send(
      JSON.stringify({
        t: 'sync',
        rid: 2,
        ops: [
          { c: 'todo', id: todo, at: Date.now(), set: { completed: true } },
        ],
      })
    )
    await one.until((m) => m.rid === 2)
    // Only the changed field travels
    const partial = await two.until(
      (m) => m.t === 'changes' && m.todos[0].completed
    )
    expect(Object.keys(partial.todos[0]).sort()).toEqual([
      'completed',
      'id',
      'updatedAt',
    ])
    // The sender doesn't get its own changes back, and other users get nothing
    expect(one.messages.filter((m) => m.t === 'changes')).toEqual([])
    expect(delegate.messages.filter((m) => m.t === 'changes')).toEqual([])
    // v1 writes reach v2 devices too
    await request(server)
      .post('/todo')
      .set('token', a.token)
      .send({ text: 'from v1', completed: false, frog: false, ...day })
      .expect(204)
    expect(
      (
        await one.until(
          (m) => m.t === 'changes' && m.todos[0].text === 'from v1'
        )
      ).todos[0].user
    ).toBe(a._id)
    for (const s of [one, two, delegate]) s.ws.close()
  })

  it('serves current and paginated lists from the database', async () => {
    const t = Date.now()
    const set = (text: string, extra: Record<string, unknown>) => ({
      c: 'todo',
      id: id(),
      at: t,
      set: { text, ...extra },
    })
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
    const current = await request(server)
      .get('/v2/todos/current?date=2026-10-13')
      .set(auth)
      .expect(200)
    expect(current.body).toMatchObject({
      total: 3,
      incomplete: 2,
      todo: { text: 'frog' },
    })
    const list = await request(server).get('/v2/todos').set(auth).expect(200)
    expect(list.body.todos.map((x: any) => x.text)).toEqual([
      'month',
      'frog',
      'second',
      'tomorrow',
    ])
    const page = await request(server)
      .get('/v2/todos?skip=1&limit=2&q=o')
      .set(auth)
      .expect(200)
    expect(page.body.todos.map((x: any) => x.text)).toEqual(['frog', 'second'])
    await request(server)
      .patch(`/v2/todos/${list.body.todos[0].id}`)
      .set(auth)
      .send({ completed: true })
      .expect(200)
    const completed = await request(server)
      .get('/v2/todos?completed=true')
      .set(auth)
      .expect(200)
    // Newest day first; a month-only todo sorts after that month's days (v1 put it first)
    expect(completed.body.todos.map((x: any) => x.text)).toEqual([
      'done',
      'month',
    ])
  })
  it('survives malformed socket messages, answers in order and keeps internals private', async () => {
    const s = socket(a.token)
    await s.ready
    // A bare `null` used to throw outside any handler: Node 16 exits on that
    for (const junk of [
      'null',
      '1',
      '"x"',
      '[]',
      '{"t":"sync","ops":"x","rid":1}',
    ])
      s.ws.send(junk)
    const todo = id()
    const op = {
      c: 'todo',
      id: todo,
      at: Date.now(),
      set: { text: 'once', ...day },
    }
    // The same create twice at once: one by one, the second is a no-op instead of a duplicate key
    s.ws.send(JSON.stringify({ t: 'sync', rid: 2, ops: [op] }))
    s.ws.send(JSON.stringify({ t: 'sync', rid: 3, ops: [op] }))
    await s.until((m) => m.rid === 3)
    expect(s.messages.filter((m) => m.t === 'error')).toEqual([
      { t: 'error', rid: 1, message: 'Invalid ops' },
    ])
    expect(
      s.messages.filter((m) => m.t === 'synced').map((m) => m.rid)
    ).toEqual([2, 3])
    // Database errors stay in the log
    const bulkWrite = jest
      .spyOn(TodoModel.collection, 'bulkWrite')
      .mockRejectedValueOnce(
        new Error('E11000 duplicate key: todorant.todos') as never
      )
    s.ws.send(JSON.stringify({ t: 'sync', rid: 4, ops: [{ ...op, id: id() }] }))
    expect(await s.until((m) => m.rid === 4)).toEqual({
      t: 'error',
      rid: 4,
      message: 'Internal Server Error',
    })
    bulkWrite.mockRestore()
    s.ws.send(JSON.stringify({ t: 'sync', rid: 5, since: 'yesterday' }))
    expect((await s.until((m) => m.rid === 5)).message).toBe('Invalid since')
    s.ws.close()
  })

  it('takes tokens in headers or a subprotocol, keeps ?token= only for released apps', async () => {
    // Browsers: new WebSocket(url, ['todorant', token]); the token is never echoed back
    const browser = socket(
      a.token,
      (base) => new WebSocket(`${base}/v2/ws`, ['todorant', a.token])
    )
    const headers: Record<string, string> = {}
    browser.ws.on('upgrade', (r) => Object.assign(headers, r.headers))
    expect((await browser.ready).user).toBe(a._id)
    expect(headers['sec-websocket-protocol']).toBe('todorant')
    const header = socket(
      a.token,
      (base) => new WebSocket(`${base}/v2/ws`, { headers: { token: a.token } })
    )
    expect((await header.ready).user).toBe(a._id)
    // The released Android app
    const android = socket(a.token)
    expect((await android.ready).user).toBe(a._id)
    const status = (ws: WebSocket) =>
      new Promise((r) =>
        ws.on('unexpected-response', (_, res) => r(res.statusCode))
      )
    expect(
      await status(new WebSocket(`${url()}/v2/ws`, ['todorant', 'forged']))
    ).toBe(401)
    for (const s of [browser, header, android]) s.ws.close()
    // REST: headers only, URLs end up in logs
    await request(server).get(`/v2/tags?token=${a.token}`).expect(401)
    await request(server).get('/v2/tags').set('token', a.token).expect(200)
    // Tokens are HS256 like sign() makes them, never 'none' (accepted by jsonwebtoken 8 without a secret)
    const hs512 = jwt.sign({ email: 'a@todorant.com' }, 'test', {
      algorithm: 'HS512',
    })
    await request(server).get('/v2/tags').set('token', hs512).expect(401)
    const secret = process.env.JWT
    delete process.env.JWT
    const none = jwt.sign({ email: 'a@todorant.com' }, '', {
      algorithm: 'none',
    })
    await request(server).get('/v2/tags').set('token', none).expect(401)
    process.env.JWT = secret
  })

  it('rations requests per user and caps sockets', async () => {
    const sockets = Array.from({ length: 20 }, () => socket(b.token))
    await Promise.all(sockets.map((s) => s.ready))
    const extra = new WebSocket(`${url()}/v2/ws?token=${b.token}`)
    expect(
      await new Promise((r) =>
        extra.on('unexpected-response', (_, res) => r(res.statusCode))
      )
    ).toBe(429)
    // A flood (or a huge pull) spends the budget: REST gets 429, sockets an error
    spend(b._id, 1000)
    await request(server).get('/v2/tags').set('token', b.token).expect(429)
    sockets[0].ws.send(JSON.stringify({ t: 'sync', rid: 1, since: 0 }))
    expect((await sockets[0].until((m) => m.rid === 1)).message).toBe(
      'Too many requests'
    )
    for (const s of sockets) s.ws.close()
    // Other users aren't affected
    await request(server).get('/v2/tags').set('token', a.token).expect(200)
  })

  it("validates values at least like v1's models, small enough not to hang anyone's app", async () => {
    const todo = (set: Record<string, unknown>) => ({
      c: 'todo',
      id: id(),
      at: Date.now(),
      set: { text: 'x', ...day, ...set },
    })
    const tag = (set: Record<string, unknown>) => ({
      c: 'tag',
      id: id(),
      at: Date.now(),
      set,
    })
    const ops = [
      todo({ frogFails: 1e9 }),
      todo({ monthAndYear: '0000-00' }),
      todo({ monthAndYear: '2026-13' }),
      todo({ date: '99' }),
      todo({ time: '99:99' }),
      todo({ text: 'x'.repeat(10001) }),
      tag({ tag: 'two words' }),
      tag({ tag: 'ok', color: 'red;background:url(//evil)' }),
      tag({ color: '#fff' }),
      todo({ constructor: null, __proto__: null, time: '23:59', frogFails: 2 }),
      tag({ tag: 'work', color: '#FF641A', epicGoal: 10 }),
    ]
    const { acks } = await sync(a.token, { ops })
    expect(ops.map((op) => acks.find((x: any) => x.id === op.id).e)).toEqual([
      'Invalid frogFails',
      'Invalid monthAndYear',
      'Invalid monthAndYear',
      'Invalid date',
      'Invalid time',
      'Invalid text',
      'Invalid tag',
      'Invalid color',
      'tag is required',
      undefined,
      undefined,
    ])
    const stored = await TodoModel.collection.findOne({
      _id: new ObjectId(ops[9].id),
    })
    expect(Object.keys(stored!)).not.toContain('constructor')
    expect(await TagModel.countDocuments({ user: a._id })).toBe(1)
    // JSON numbers that overflow parse as Infinity
    const infinite = await request(server)
      .post('/v2/sync')
      .set('authorization', `Bearer ${a.token}`)
      .set('content-type', 'application/json')
      .send(
        `{"ops":[{"c":"todo","id":"${id()}","at":1,"set":{"text":"x","monthAndYear":"2026-10","order":1e999}}]}`
      )
      .expect(200)
    expect(infinite.body.acks[0].e).toBe('Invalid order')
    const settings = async (set: Record<string, unknown>) =>
      (await sync(a.token, { ops: [{ c: 'settings', at: Date.now(), set }] }))
        .acks[0]
    for (const set of [
      { language: 'x'.repeat(100) },
      { firstDayOfWeek: 7 },
      { startTimeOfDay: '24:00' },
      { googleCalendarCredentials: { $where: 'sleep(1000)' } },
      { googleCalendarCredentials: { 'a.b': 'x' } },
      { googleCalendarCredentials: { nested: { deep: true } } },
      { googleCalendarCredentials: ['x'] },
    ])
      expect((await settings(set)).e).toMatch(/^Invalid /)
    const credentials = {
      access_token: 'ya29.x',
      refresh_token: '1//x',
      scope: 'https://www.googleapis.com/auth/calendar',
      token_type: 'Bearer',
      id_token: null,
      expiry_date: Date.now(),
    }
    expect(
      await settings({
        language: 'pt-BR',
        firstDayOfWeek: 0,
        googleCalendarCredentials: credentials,
      })
    ).not.toHaveProperty('e')
    expect(
      (await UserModel.findById(a._id))!.settings.googleCalendarCredentials
    ).toEqual(credentials)
    const auth = { authorization: `Bearer ${a.token}` }
    await request(server)
      .patch('/v2/settings')
      .set(auth)
      .send({ firstDayOfWeek: -1 })
      .expect(400)
    await request(server)
      .patch('/v2/me')
      .set(auth)
      .send({ name: '  ' })
      .expect(400)
    await request(server)
      .post('/v2/sync')
      .set(auth)
      .send({ since: 'abc' })
      .expect(400)
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`).join(',')
    await request(server).get(`/v2/todos?hash=${tags}`).set(auth).expect(400)
  })

  it('keeps delegation consensual: only delegates accept, and leaving locks the delegator out', async () => {
    const c = await user('c@todorant.com')
    await request(server)
      .post('/v2/delegation/accept')
      .set('authorization', `Bearer ${b.token}`)
      .send({ token: (await UserModel.findById(a._id))!.delegateInviteToken })
      .expect(200)
    const todo = id()
    const create = await sync(a.token, {
      ops: [
        {
          c: 'todo',
          id: todo,
          at: Date.now(),
          set: {
            text: 'for b',
            user: b._id,
            delegator: a._id,
            delegateAccepted: true,
          },
        },
      ],
    })
    expect(create.acks[0].e).toBeUndefined()
    expect((await TodoModel.findById(todo))!.delegateAccepted).toBe(false)
    const accept = await sync(a.token, {
      ops: [
        {
          c: 'todo',
          id: todo,
          at: Date.now(),
          set: { delegateAccepted: true, text: 'edited' },
        },
      ],
    })
    expect(accept.acks[0].fix).toEqual({ delegateAccepted: false })
    expect((await TodoModel.findById(todo))!.text).toBe('edited')
    // b leaves: a can't touch (or resurrect) what's in b's account anymore
    await request(server)
      .delete(`/v2/delegation/delegators/${a._id}`)
      .set('authorization', `Bearer ${b.token}`)
      .expect(204)
    const after = await sync(a.token, {
      ops: [
        {
          c: 'todo',
          id: todo,
          at: Date.now() + 1,
          set: { text: 'still here' },
        },
      ],
    })
    expect(after.acks[0].fix).toEqual({ text: 'edited' })
    // Strangers naming b's id don't make b's devices pull
    const victim = socket(b.token)
    await victim.ready
    for (const path of [
      `/v2/delegation/delegators/${b._id}`,
      `/v2/delegation/delegates/${b._id}`,
    ])
      await request(server)
        .delete(path)
        .set('authorization', `Bearer ${c.token}`)
        .expect(204)
    await pause(200)
    expect(victim.messages.filter((m) => m.t === 'pull')).toEqual([])
    victim.ws.close()
  })

  it('hardens the logins the web uses', async () => {
    // QR codes: an operator instead of a uuid used to return whoever scanned last
    const { uuid } = (await request(server).get('/login/generate_uuid')).body
    await request(server)
      .post('/login/qr_token')
      .set('token', a.token)
      .send({ uuid })
      .expect(204)
    for (const injection of [{ $ne: null }, { $regex: '.' }]) {
      const stolen = await request(server)
        .post('/v2/auth/qr_check')
        .send({ uuid: injection })
      expect(stolen.status).toBe(403)
      expect(stolen.body.token).toBeUndefined()
      await request(server)
        .post('/login/qr_token')
        .set('token', b.token)
        .send({ uuid: injection })
        .expect(403)
    }
    expect(
      (await request(server).post('/v2/auth/qr_check').send({ uuid })).body
    ).toEqual({ token: a.token })
    expect(
      (
        await request(server)
          .post('/v2/auth/qr_check')
          .send({ uuid: 'nope' })
          .expect(200)
      ).body
    ).toEqual({})
    // Google: tokens other apps got for the same person don't log in
    const tokeninfo = 'https://www.googleapis.com/oauth2/v3/tokeninfo'
    axiosMock
      .onGet(`${tokeninfo}?access_token=foreign`)
      .reply(200, { aud: '1234-evil.apps.googleusercontent.com' })
    axiosMock
      .onGet(`${tokeninfo}?access_token=own`)
      .reply(200, { aud: WEB_CLIENT })
    axiosMock
      .onGet('https://www.googleapis.com/oauth2/v3/userinfo')
      .reply(200, { name: 'A', email: 'a@todorant.com', email_verified: true })
    await request(server)
      .post('/v2/auth/google-firebase')
      .send({ accessToken: 'foreign' })
      .expect(403)
    expect(
      (
        await request(server)
          .post('/v2/auth/google-firebase')
          .send({ accessToken: 'own' })
          .expect(200)
      ).body._id
    ).toBe(a._id)
    axiosMock.onGet(`${tokeninfo}?id_token=foreign`).reply(200, {
      aud: '1234-evil.apps.googleusercontent.com',
      name: 'A',
      email: 'a@todorant.com',
      email_verified: 'true',
    })
    axiosMock.onGet(`${tokeninfo}?id_token=unverified`).reply(200, {
      aud: WEB_CLIENT,
      name: 'A',
      email: 'a@todorant.com',
      email_verified: 'false',
    })
    axiosMock.onGet(`${tokeninfo}?id_token=own`).reply(200, {
      aud: WEB_CLIENT,
      name: 'A',
      email: 'a@todorant.com',
      email_verified: 'true',
    })
    await request(server)
      .post('/v2/auth/google')
      .send({ accessToken: 'foreign' })
      .expect(403)
    await request(server)
      .post('/v2/auth/google')
      .send({ accessToken: 'unverified' })
      .expect(403)
    expect(
      (
        await request(server)
          .post('/v2/auth/google')
          .send({ accessToken: 'own' })
          .expect(200)
      ).body._id
    ).toBe(a._id)
    // Facebook: the app secret proof makes Facebook refuse other apps' tokens
    process.env.FACEBOOK_APP_SECRET = 'fb-secret'
    let path = ''
    facebookApiSpy.mockImplementationOnce(
      (p: string, done: (e: null, u: unknown) => void) => {
        path = p
        done(null, { id: '1', name: 'F', email: 'f@todorant.com' })
      }
    )
    await request(server)
      .post('/v2/auth/facebook')
      .send({ accessToken: 'fb-token' })
      .expect(200)
    expect(path).toContain(
      `appsecret_proof=${createHmac('sha256', 'fb-secret')
        .update('fb-token')
        .digest('hex')}`
    )
    // Telegram: a signed payload is only good for a day, not forever
    process.env.TELEGRAM_LOGIN_TOKEN = 'bot-token'
    const telegram = (age: number) => {
      const data: Record<string, string> = {
        id: '42',
        first_name: 'T',
        auth_date: String(Math.floor(Date.now() / 1000) - age),
      }
      const check = Object.keys(data)
        .sort()
        .map((k) => `${k}=${data[k]}`)
        .join('\n')
      const key = createHash('sha256').update('bot-token').digest()
      return {
        ...data,
        hash: createHmac('sha256', key).update(check).digest('hex'),
      }
    }
    await request(server)
      .post('/v2/auth/telegram')
      .send(telegram(2 * 24 * 3600))
      .expect(403)
    await request(server)
      .post('/v2/auth/telegram')
      .send(telegram(60))
      .expect(200)
    // Apple: RS256 only; HS256 "signed" with Apple's public key used to pass
    await UserModel.create({
      name: 'Victim',
      appleSubId: 'victim-sub',
      token: await sign({ appleSubId: 'victim-sub' }),
      delegateInviteToken: randToken.generate(16),
    })
    const claims = { sub: 'victim-sub', aud: 'com.todorant.web' }
    const forged = jwt.sign(claims, mockApple.publicKey, {
      algorithm: 'HS256',
      keyid: 'k',
    })
    const apple = (token: string) =>
      request(server)
        .post('/v2/auth/apple-firebase')
        .send({ credential: { oauthIdToken: token } })
    const attack = await apple(forged)
    expect(attack.status).not.toBe(200)
    expect(attack.body.token).toBeUndefined()
    const real = jwt.sign(claims, mockApple.privateKey, {
      algorithm: 'RS256',
      keyid: 'k',
    })
    expect((await apple(real).expect(200)).body.name).toBe('Victim')
    // Apple's form post comes back to the web with its state, so the web can tell it asked for it
    const back = await request(server)
      .post('/v2/auth/apple_login_result')
      .type('form')
      .send({ id_token: 'x', state: 'nonce 1' })
    expect(back.header.location).toMatch(/&state=nonce%201$/)
    delete process.env.FACEBOOK_APP_SECRET
    delete process.env.TELEGRAM_LOGIN_TOKEN
  })

  it('binds Google Calendar codes to the account that asked for them', async () => {
    const auth = (u: { token: string }) => ({ token: u.token })
    const link = (
      await request(server)
        .get('/google/calendarAuthenticationURL?web=true')
        .set(auth(a))
        .expect(200)
    ).text
    const state = new URL(link).searchParams.get('state')!
    expect(((await verify(state)) as any).calendar).toBe(a._id)
    // A link carrying a's code and state, opened by b, is refused before Google is asked
    for (const forged of [state, 'garbage'])
      await request(server)
        .post('/google/calendarAuthorize')
        .set(auth(b))
        .send({ code: 'a-code', web: true, state: forged })
        .expect(403)
  })
  it('signs up and in with email + password, apart from OAuth accounts', async () => {
    const post = (path: string, body: object) =>
      request(server).post(`/v2/auth/${path}`).send(body)
    // An OAuth account with this email exists: a password account must not take it over
    const oauth = await user('owner@example.com')
    const created = await post('signup', {
      email: ' Owner@Example.com ',
      password: 'correct horse',
      name: 'Pw',
    }).expect(200)
    expect(created.body._id).not.toBe(oauth._id)
    expect(created.body.passwordLogin).toBe('owner@example.com')
    expect(created.body.email).toBeUndefined()
    expect(created.body.passwordHash).toBeUndefined()
    await post('signup', {
      email: 'owner@example.com',
      password: 'another one',
    }).expect(409)
    await post('signup', { email: 'nope', password: 'correct horse' }).expect(
      400
    )
    await post('signup', { email: 'x@example.com', password: 'short' }).expect(
      400
    )
    // Signing in returns the same account and a working token
    const signedIn = await post('password', {
      email: 'owner@example.com',
      password: 'correct horse',
    }).expect(200)
    expect(signedIn.body._id).toBe(created.body._id)
    expect(
      (await sync(signedIn.body.token, { since: 0 })).user.passwordLogin
    ).toBe('owner@example.com')
    await post('password', {
      email: 'owner@example.com',
      password: 'wrong horse',
    }).expect(401)
    await post('password', {
      email: 'nobody@example.com',
      password: 'correct horse',
    }).expect(401)
    // Guessing is limited
    for (let i = 0; i < 10; i++)
      await post('password', {
        email: 'owner@example.com',
        password: `wrong guess ${i}`,
      })
    await post('password', {
      email: 'owner@example.com',
      password: 'correct horse',
    }).expect(429)
  })

  it('deletes an account with everything it owns, leaving others what they accepted', async () => {
    const signup = await request(server)
      .post('/v2/auth/signup')
      .send({ email: 'gone@example.com', password: 'correct horse' })
      .expect(200)
    const d = {
      token: signup.body.token as string,
      _id: String(signup.body._id),
    }
    const accept = async (who: { token: string }, inviter: { _id: string }) =>
      request(server)
        .post('/v2/delegation/accept')
        .set('authorization', `Bearer ${who.token}`)
        .send({
          token: (await UserModel.findById(inviter._id))!.delegateInviteToken,
        })
        .expect(200)
    // a and d delegate to each other
    await accept(d, a)
    await accept(a, d)
    const [own, accepted, pending, toD] = [id(), id(), id(), id()]
    const at = Date.now()
    const delegated = (text: string, user: string, delegator: string) => ({
      text,
      ...day,
      user,
      delegator,
    })
    await sync(d.token, {
      ops: [
        { c: 'todo', id: own, at, set: { text: 'mine', ...day } },
        { c: 'tag', id: id(), at, set: { tag: 'gone' } },
        { c: 'hero', at, set: { points: 5 } },
        { c: 'todo', id: accepted, at, set: delegated('for a', a._id, d._id) },
        { c: 'todo', id: pending, at, set: delegated('secret', a._id, d._id) },
      ],
    })
    await sync(a.token, {
      ops: [
        { c: 'todo', id: toD, at, set: delegated('for d', d._id, a._id) },
        { c: 'todo', id: accepted, at, set: { delegateAccepted: true } },
      ],
    })
    const { cursor } = await sync(a.token, { since: 0 })
    const remove = (token: string) =>
      request(server)
        .delete('/v2/account')
        .set('authorization', `Bearer ${token}`)
    await remove(d.token).expect(204)
    // The token is dead and nothing of d is left but tombstones for a's devices
    await remove(d.token).expect(401)
    await request(server)
      .post('/v2/sync')
      .set('authorization', `Bearer ${d.token}`)
      .send({ since: 0 })
      .expect(401)
    expect(await UserModel.findById(d._id)).toBeNull()
    expect(await TodoModel.findById(own)).toBeNull()
    expect(await TagModel.countDocuments({ user: d._id })).toBe(0)
    expect(await HeroModel.countDocuments({ user: d._id })).toBe(0)
    expect(
      await TodoModel.countDocuments({ text: { $in: ['mine', 'secret'] } })
    ).toBe(0)
    expect((await UserModel.findById(a._id))!.delegates).toHaveLength(0)
    const delta = await sync(a.token, { since: cursor })
    const sent = Object.fromEntries(delta.todos.map((t: any) => [t.id, t]))
    expect(sent[accepted]).toMatchObject({
      text: 'for a',
      user: a._id,
      delegator: null,
      deleted: false,
    })
    expect(sent[pending]).toMatchObject({
      deleted: true,
      text: '',
      delegator: null,
    })
    expect(sent[toD]).toMatchObject({ deleted: true })
    expect(delta.delegation).toEqual({ delegates: [], delegators: [] })
    // The accepted todo is a's to edit now
    const { acks } = await sync(a.token, {
      ops: [
        { c: 'todo', id: accepted, at: Date.now(), set: { text: 'mine now' } },
      ],
    })
    expect(acks[0].fix).toBeUndefined()
  })
})
