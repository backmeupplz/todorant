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
} from '@/__tests__/v2Harness'
import * as request from 'supertest'
import { ApiTokenModel, MAX_API_TOKENS } from '@/models/apiToken'
import { TodoModel } from '@/models/todo'
import { UserModel } from '@/models/user'
import { createHash } from 'crypto'

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

/** Makes a token through the API, the way a signed-in browser does */
async function create(session: string, name = 'My script') {
  const res = await request(server)
    .post('/v2/tokens')
    .set(bearer(session))
    .send({ name })
    .expect(201)
  return res.body as {
    id: string
    name: string
    prefix: string
    token: string
    createdAt: number
    lastUsedAt: null
  }
}

describe('personal API tokens', () => {
  setupV2()

  it('creates a token, shows it once and stores only its hash', async () => {
    const made = await create(a.token, '  CLI  ')
    expect(made.token).toMatch(/^tdr_[A-Za-z0-9_-]{43}$/)
    expect(made.name).toBe('CLI')
    expect(made.prefix).toBe(made.token.slice(0, 8))
    const stored = (await ApiTokenModel.findById(made.id).lean())!
    expect(stored.hash).toBe(
      createHash('sha256').update(made.token).digest('hex')
    )
    expect(JSON.stringify(stored)).not.toContain(made.token)
    expect(String(stored.user)).toBe(a._id)
    // Two tokens are never the same
    expect((await create(a.token)).token).not.toBe(made.token)
  })

  it('lists name, prefix and dates, never the hash or the token', async () => {
    const made = await create(a.token)
    await create(b.token, 'not a')
    const res = await request(server)
      .get('/v2/tokens')
      .set(bearer(a.token))
      .expect(200)
    expect(res.body.tokens).toEqual([
      {
        id: made.id,
        name: 'My script',
        prefix: made.prefix,
        createdAt: made.createdAt,
        lastUsedAt: null,
      },
    ])
    expect(res.text).not.toContain(made.token)
    expect(res.text).not.toMatch(/hash|sha256/i)
    expect(res.text).not.toContain(
      createHash('sha256').update(made.token).digest('hex')
    )
  })

  it('validates the name and caps the tokens per account', async () => {
    for (const name of ['', '   ', 'x'.repeat(61), 5, undefined])
      await request(server)
        .post('/v2/tokens')
        .set(bearer(a.token))
        .send({ name })
        .expect(400)
    await ApiTokenModel.insertMany(
      Array.from({ length: MAX_API_TOKENS }, (_, i) => ({
        user: a._id,
        name: `t${i}`,
        hash: `hash${i}`,
        prefix: 'tdr_0000',
      }))
    )
    await request(server)
      .post('/v2/tokens')
      .set(bearer(a.token))
      .send({ name: 'one too many' })
      .expect(409)
    // Another account has its own budget
    await create(b.token)
  })

  it('works as a Bearer token and as the token header on v2 REST', async () => {
    const { token } = await create(a.token)
    const created = await request(server)
      .post('/v2/todos')
      .set(bearer(token))
      .send({ text: 'from a script', ...day })
      .expect(200)
    const todo = created.body.acks[0]
    expect(todo.e).toBeUndefined()
    // The token header is the v1 spelling of the same thing
    const current = await request(server)
      .get('/v2/todos/current?date=2026-10-13')
      .set('token', token)
      .expect(200)
    expect(current.body.todo.text).toBe('from a script')
    const list = await request(server)
      .get('/v2/todos')
      .set(bearer(token))
      .expect(200)
    expect(list.body.todos.map((t: any) => t.text)).toEqual(['from a script'])
    await request(server)
      .patch(`/v2/todos/${todo.id}`)
      .set(bearer(token))
      .send({ completed: true })
      .expect(200)
    expect((await TodoModel.findById(todo.id))!.completed).toBe(true)
    // The same data a session sees; nothing of another account
    const other = await sync(b.token, { since: 0 })
    expect(other.todos).toEqual([])
    const sameData = await request(server)
      .post('/v2/sync')
      .set(bearer(token))
      .send({ since: 0 })
      .expect(200)
    expect(sameData.body.todos.map((t: any) => t.id)).toEqual([todo.id])
    await request(server)
      .delete(`/v2/todos/${todo.id}`)
      .set(bearer(token))
      .expect(200)
  })

  it('works on v1 endpoints and sockets too', async () => {
    const { token } = await create(a.token)
    const state = await request(server)
      .get('/state?date=2026-10-13')
      .set('token', token)
      .expect(200)
    expect(state.body.userInfo.name).toBe('a@todorant.com')
    const live = socket(token)
    expect((await live.ready).user).toBe(a._id)
    live.ws.close()
    // Forged and unknown ones don't
    for (const bad of ['tdr_', `tdr_${'A'.repeat(43)}`, 'tdr_{"$ne":1}'])
      await request(server).get('/v2/todos').set(bearer(bad)).expect(401)
    await request(server)
      .get('/state?date=2026-10-13')
      .set('token', `tdr_${'A'.repeat(43)}`)
      .expect(403)
  })

  it('stops working when revoked: REST, v1, and sockets that are already open', async () => {
    const keep = await create(a.token, 'keep')
    const revoked = await create(a.token, 'revoke me')
    const open = socket(revoked.token)
    await open.ready
    const closed = new Promise<number>((resolve) =>
      open.ws.on('close', resolve)
    )
    await request(server)
      .delete(`/v2/tokens/${revoked.id}`)
      .set(bearer(a.token))
      .expect(204)
    expect(await closed).toBe(4401)
    await request(server)
      .get('/v2/todos')
      .set(bearer(revoked.token))
      .expect(401)
    await request(server)
      .get('/state?date=2026-10-13')
      .set('token', revoked.token)
      .expect(403)
    // A refused reconnect, and the session and the other token are untouched
    const again = socket(revoked.token)
    await new Promise((resolve) => again.ws.on('error', resolve))
    await request(server).get('/v2/todos').set(bearer(keep.token)).expect(200)
    await request(server).get('/v2/todos').set(bearer(a.token)).expect(200)
    const list = await request(server).get('/v2/tokens').set(bearer(a.token))
    expect(list.body.tokens.map((t: any) => t.name)).toEqual(['keep'])
  })

  it("revokes only the caller's own tokens", async () => {
    const mine = await create(a.token)
    await request(server)
      .delete(`/v2/tokens/${mine.id}`)
      .set(bearer(b.token))
      .expect(404)
    await request(server)
      .delete('/v2/tokens/nope')
      .set(bearer(a.token))
      .expect(400)
    await request(server).get('/v2/todos').set(bearer(mine.token)).expect(200)
  })

  it('records when a token was last used, at most every 10 minutes', async () => {
    const { token, id: tokenId } = await create(a.token)
    const lastUsed = async () =>
      (await ApiTokenModel.findById(tokenId).lean())!.lastUsedAt
    expect(await lastUsed()).toBeUndefined()
    await request(server).get('/v2/todos').set(bearer(token)).expect(200)
    // The write isn't awaited by the request
    await new Promise((resolve) => setTimeout(resolve, 200))
    const first = (await lastUsed())!
    expect(first).toBeInstanceOf(Date)
    await request(server).get('/v2/todos').set(bearer(token)).expect(200)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await lastUsed()).toEqual(first)
    const old = new Date(Date.now() - 11 * 60 * 1000)
    await ApiTokenModel.updateOne({ _id: tokenId }, { lastUsedAt: old })
    await request(server).get('/v2/todos').set(bearer(token)).expect(200)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect((await lastUsed())!.getTime()).toBeGreaterThan(old.getTime())
    const list = await request(server).get('/v2/tokens').set(bearer(a.token))
    expect(list.body.tokens[0].lastUsedAt).toBeGreaterThan(old.getTime())
  })

  describe('an API token never reaches the account itself', () => {
    it("can't list, create or revoke tokens", async () => {
      const { token, id: tokenId } = await create(a.token)
      for (const call of [
        request(server).get('/v2/tokens').set(bearer(token)),
        request(server)
          .post('/v2/tokens')
          .set(bearer(token))
          .send({ name: 'minted' }),
        request(server).delete(`/v2/tokens/${tokenId}`).set(bearer(token)),
        request(server).get('/v2/tokens').set('token', token),
      ])
        await call.expect(403)
      expect(await ApiTokenModel.countDocuments({ user: a._id })).toBe(1)
      // And a token's own revoke attempt didn't revoke it
      await request(server).get('/v2/todos').set(bearer(token)).expect(200)
    })

    it("can't delete the account", async () => {
      const { token } = await create(a.token)
      await request(server).delete('/v2/account').set(bearer(token)).expect(403)
      await request(server)
        .delete('/v2/account')
        .set('token', token)
        .expect(403)
      expect(await UserModel.findById(a._id)).not.toBeNull()
    })

    it("can't get the session token or link another login", async () => {
      const { token } = await create(a.token)
      // Both v1 and v2 spell the same handler
      for (const path of ['/login/token', '/v2/auth/token']) {
        const res = await request(server).post(path).send({ token }).expect(200)
        expect(res.body.name).toBe('a@todorant.com')
        expect(res.body.token).toBeUndefined()
        expect(res.body.anonymousToken).toBeUndefined()
        expect(res.text).not.toContain(a.token)
      }
      // A session still gets its own profile with the token, as the apps expect
      const own = await request(server)
        .post('/login/token')
        .send({ token: a.token })
        .expect(200)
      expect(own.body.token).toBe(a.token)
      // Merging a login in (it would sign the attacker in as the owner) and QR logins
      for (const path of [
        '/merge/google',
        '/merge/facebook',
        '/merge/telegram',
        '/login/qr_token',
      ])
        await request(server)
          .post(path)
          .set('token', token)
          .send({ uuid: 'x', accessToken: 'x' })
          .expect(403)
    })

    it('an unknown token on /login/token is refused, not a crash', async () => {
      await request(server)
        .post('/login/token')
        .send({ token: `tdr_${'A'.repeat(43)}` })
        .expect(403)
    })
  })

  it('deleting the account deletes its tokens, and only its own', async () => {
    const mine = await create(a.token)
    await create(a.token, 'second')
    const theirs = await create(b.token)
    await request(server).delete('/v2/account').set(bearer(a.token)).expect(204)
    expect(await ApiTokenModel.countDocuments({ user: a._id })).toBe(0)
    expect(await ApiTokenModel.countDocuments({ user: b._id })).toBe(1)
    await request(server).get('/v2/todos').set(bearer(mine.token)).expect(401)
    await request(server).get('/v2/todos').set(bearer(theirs.token)).expect(200)
  })

  it('forgets the tokens of an account that no longer exists', async () => {
    const { token, id: tokenId } = await create(a.token)
    await UserModel.deleteOne({ _id: a._id })
    await request(server).get('/v2/todos').set(bearer(token)).expect(401)
    expect(await ApiTokenModel.findById(tokenId)).toBeNull()
  })

  it('keeps ids and tokens apart: a todo id is no token', async () => {
    const todo = id()
    await request(server)
      .get('/v2/todos')
      .set(bearer(`tdr_${todo}`))
      .expect(401)
  })
})
