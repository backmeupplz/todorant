/* eslint-disable @typescript-eslint/no-non-null-assertion */
// The harness comes first: it mocks modules (jwks-rsa, nodemailer) that the app and helpers import
/* eslint-disable sort-imports-es6-autofix/sort-imports-es6 */
import {
  WEB_CLIENT,
  axiosMock,
  a,
  b,
  day,
  id,
  mockApple,
  mockMail,
  server,
  setupV2,
  socket,
  sync,
  user,
} from '@/__tests__/v2Harness'
import * as jwt from 'jsonwebtoken'
import * as randToken from 'rand-token'
import * as request from 'supertest'
import { HeroModel } from '@/models/hero'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { URL } from 'url'
import { UserModel } from '@/models/user'
import { createHash, createHmac } from 'crypto'
import { facebookApiSpy } from '@/__tests__/testUtils'
import { sign } from '@/helpers/jwt'

describe('v2 delegation and accounts', () => {
  setupV2()

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
    // The server hints before it answers, and one socket keeps order: a pull would come before this reply
    victim.ws.send(JSON.stringify({ t: 'sync', rid: 1 }))
    await victim.until((m) => m.rid === 1)
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
    // Tokens the provider rejects are 401s; the provider being down stays a 5xx
    axiosMock.onGet(`${tokeninfo}?id_token=expired`).reply(400)
    axiosMock.onGet(`${tokeninfo}?access_token=expired`).reply(400)
    axiosMock.onGet(`${tokeninfo}?id_token=down`).reply(503)
    facebookApiSpy.mockImplementationOnce(
      (_: string, done: (e: unknown) => void) =>
        done({ type: 'OAuthException', code: 190 })
    )
    for (const [provider, body] of [
      ['google', { accessToken: 'expired' }],
      ['google-firebase', { accessToken: 'expired' }],
      ['facebook', { accessToken: 'expired' }],
      ['apple-firebase', { credential: { oauthIdToken: 'garbage' } }],
      ['apple-firebase', {}],
    ] as const)
      await request(server).post(`/v2/auth/${provider}`).send(body).expect(401)
    await request(server)
      .post('/v2/auth/google')
      .send({ accessToken: 'down' })
      .expect(500)
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

  it('creates an email + password account only once the emailed link is opened', async () => {
    process.env.SMTP_URL = 'smtp://mock'
    process.env.BACKEND_URL = 'https://backend.example.com'
    try {
      // Another client than the earlier tests, which used up 127.0.0.1's sign-in attempts
      const post = (path: string, body: object) =>
        request(server)
          .post(`/v2/auth/${path}`)
          .set('x-forwarded-for', '203.0.113.7')
          .send(body)
      const body = { email: 'Verify@Example.com', password: 'correct horse' }
      const sent = await post('signup', body).expect(403)
      expect(sent.body.error).toContain('verify@example.com')
      expect(
        await UserModel.exists({ passwordLogin: 'verify@example.com' })
      ).toBeFalsy()
      // Signing in before confirming says so
      expect((await post('password', body).expect(403)).body.error).toContain(
        'Confirm'
      )
      // Signing up again replaces the link
      await post('signup', body).expect(403)
      expect(mockMail.length).toBe(2)
      const link = (text: string) => new URL(text.match(/http\S+/)![0])
      const old = link(mockMail[0].text)
      const fresh = link(mockMail[1].text)
      expect(mockMail[1].to).toBe('verify@example.com')
      await request(server)
        .get(old.pathname + old.search)
        .expect(404)
      await request(server)
        .get(fresh.pathname + fresh.search)
        .expect(200)
      await request(server)
        .get(fresh.pathname + fresh.search)
        .expect(404)
      await post('password', body).expect(200)
      await post('signup', body).expect(409)
    } finally {
      delete process.env.SMTP_URL
      delete process.env.BACKEND_URL
    }
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
