/* eslint-disable @typescript-eslint/no-non-null-assertion */
// The harness comes first: it mocks modules (jwks-rsa, nodemailer) that the app and helpers import
/* eslint-disable sort-imports-es6-autofix/sort-imports-es6 */
import {
  a,
  b,
  day,
  id,
  server,
  setupV2,
  socket,
  sync,
  url,
} from '@/__tests__/v2Harness'
import * as WebSocket from 'ws'
import * as jwt from 'jsonwebtoken'
import * as request from 'supertest'
import { ObjectId } from 'mongodb'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { UserModel } from '@/models/user'
import { spend } from '@/v2/auth'

describe('v2 sync and API', () => {
  setupV2()

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
    ])
      expect((await settings(set)).e).toMatch(/^Invalid /)
    // Shipped apps still send the removed Google Calendar settings: ignored, not stored
    expect(
      await settings({
        language: 'pt-BR',
        firstDayOfWeek: 0,
        googleCalendarCredentials: { access_token: 'ya29.x' },
        removeCompletedFromCalendar: false,
      })
    ).not.toHaveProperty('e')
    const saved = (await UserModel.findById(a._id))!.settings as any
    expect(saved.language).toBe('pt-BR')
    expect(saved).not.toHaveProperty('googleCalendarCredentials')
    expect(saved).not.toHaveProperty('removeCompletedFromCalendar')
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
})
