/* eslint-disable @typescript-eslint/no-non-null-assertion */
// The harness comes first: it mocks modules (jwks-rsa, nodemailer) that the app and helpers import
/* eslint-disable sort-imports-es6-autofix/sort-imports-es6 */
import {
  WEB_CLIENT,
  axiosMock,
  mockApple,
  mockMail,
  server,
  setupV2,
} from '@/__tests__/v2Harness'
import * as jwt from 'jsonwebtoken'
import * as mongoose from 'mongoose'
import * as request from 'supertest'
import { URL } from 'url'
import { UserModel } from '@/models/user'
import {
  CampaignSignupModel,
  campaignOf,
  countSignup,
} from '@/models/campaignSignup'
import { createHash, createHmac } from 'crypto'
import { facebookApiSpy } from '@/__tests__/testUtils'

const today = () => new Date().toISOString().slice(0, 10)
const counts = async () =>
  (
    await CampaignSignupModel.find(
      {},
      { _id: 0, day: 1, campaign: 1, count: 1 }
    )
      .sort({ campaign: 1 })
      .lean()
  ).map(({ day, campaign, count }) => ({ day, campaign, count }))
const post = (path: string, body: object) =>
  request(server).post(`/v2/auth/${path}`).send(body)

describe('sign-ups per utm_campaign', () => {
  setupV2()

  it('accepts only short plain campaign names', () => {
    for (const ok of ['p7-a', 'test-a', 'A_b-9', 'x', 'a'.repeat(64)])
      expect(campaignOf(ok)).toBe(ok)
    for (const bad of [
      '',
      'a'.repeat(65),
      'p7 a',
      'p7.a',
      'p7/a',
      '<script>',
      'кампания',
      'p7-a\n',
      undefined,
      null,
      7,
      ['p7-a'],
      { $ne: null },
    ])
      expect(campaignOf(bad)).toBeUndefined()
  })

  it('counts per UTC day and campaign, also when the first ones of a day race', async () => {
    await countSignup('p7-a', new Date('2026-11-06T23:59:59.999Z'))
    await countSignup('p7-a', new Date('2026-11-07T00:00:00.000Z'))
    await Promise.all(
      Array.from({ length: 10 }, () =>
        countSignup('race', new Date('2026-11-07T12:00:00Z'))
      )
    )
    await countSignup('p7 a; drop', new Date('2026-11-07T12:00:00Z'))
    await countSignup(undefined)
    expect(await counts()).toEqual([
      { day: '2026-11-06', campaign: 'p7-a', count: 1 },
      { day: '2026-11-07', campaign: 'p7-a', count: 1 },
      { day: '2026-11-07', campaign: 'race', count: 10 },
    ])
  })

  it('never fails a sign-up when counting does', async () => {
    const spy = jest
      .spyOn(CampaignSignupModel, 'updateOne')
      .mockImplementation(() => {
        throw new Error('database down')
      })
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    try {
      await post('signup', {
        email: 'down@example.com',
        password: 'correct horse',
        campaign: 'p7-a',
      }).expect(200)
      expect(error).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      error.mockRestore()
    }
  })

  it('counts new email accounts once, never sign-ins, and keeps nothing per person', async () => {
    const body = {
      email: 'new@example.com',
      password: 'correct horse',
      campaign: 'test-a',
    }
    const created = await post('signup', body).expect(200)
    expect(await counts()).toEqual([
      { day: today(), campaign: 'test-a', count: 1 },
    ])
    // Signing in (with the campaign still around) and signing up again don't count
    await post('password', body).expect(200)
    await post('signup', body).expect(409)
    // Invalid campaigns are dropped, accounts without one aren't counted
    await post('signup', {
      ...body,
      email: 'evil@example.com',
      campaign: { $gt: '' },
    }).expect(200)
    await post('signup', {
      email: 'plain@example.com',
      password: 'correct horse',
    }).expect(200)
    await post('signup', { ...body, email: 'second@example.com' }).expect(200)
    expect(await counts()).toEqual([
      { day: today(), campaign: 'test-a', count: 2 },
    ])
    // Nothing about the campaign on the account, or in any other collection than the counters
    const account = await UserModel.findById(created.body._id).lean()
    expect(JSON.stringify(account)).not.toContain('test-a')
    expect(created.body.campaign).toBeUndefined()
    for (const collection of Object.values(mongoose.connection.collections))
      if (collection.collectionName !== 'campaignsignups')
        expect(JSON.stringify(await collection.find().toArray())).not.toContain(
          'test-a'
        )
  })

  it('counts an emailed sign-up when its link is opened, once', async () => {
    process.env.SMTP_URL = 'smtp://mock'
    process.env.BACKEND_URL = 'https://backend.example.com'
    const db = mongoose.connection.db
    // Only the counters may ever hold the campaign: never the pending sign-up next to the email
    const nowhereBut = async (campaign: string) => {
      for (const { name } of await db.listCollections().toArray())
        if (name !== 'campaignsignups')
          expect(
            JSON.stringify(await db.collection(name).find().toArray())
          ).not.toContain(campaign)
    }
    const linkOf = (mail: { text: string }) =>
      new URL(mail.text.match(/http\S+/)![0])
    const open = (link: URL) => request(server).get(link.pathname + link.search)
    try {
      mockMail.length = 0
      const body = { email: 'mail@example.com', password: 'correct horse' }
      await post('signup', { ...body, campaign: 'p7-b' }).expect(403)
      expect(await db.collection('pendingsignups').countDocuments()).toBe(1)
      await nowhereBut('p7-b')
      expect(await counts()).toEqual([])
      // The link carries the campaign; opening it creates the account and counts it once
      const link = linkOf(mockMail[0])
      expect(link.searchParams.get('c')).toBe('p7-b')
      await open(link).expect(200)
      await open(link).expect(404)
      await post('password', { ...body, campaign: 'p7-b' }).expect(200)
      expect(await counts()).toEqual([
        { day: today(), campaign: 'p7-b', count: 1 },
      ])
      await nowhereBut('p7-b')

      // Signing up for an existing account sends nothing; an invalid campaign stays out of the link
      await post('signup', { ...body, campaign: 'p7-b' }).expect(409)
      const other = { email: 'other@example.com', password: 'correct horse' }
      await post('signup', { ...other, campaign: 'bad campaign!' }).expect(403)
      const plain = linkOf(mockMail[1])
      expect(plain.searchParams.has('c')).toBe(false)
      // A forged or invalid `c` on the link is ignored, the account is still created
      plain.searchParams.set('c', 'bad campaign!')
      await open(plain).expect(200)
      await post('password', other).expect(200)
      expect(await counts()).toEqual([
        { day: today(), campaign: 'p7-b', count: 1 },
      ])

      // A link opened after the account already exists (made another way) doesn't count
      const late = { email: 'late@example.com', password: 'correct horse' }
      await post('signup', { ...late, campaign: 'p7-l' }).expect(403)
      // Without a mailer, signing up creates the account right away (no campaign: not counted)
      delete process.env.SMTP_URL
      await post('signup', late).expect(200)
      await open(linkOf(mockMail[2])).expect(200)
      expect(await counts()).toEqual([
        { day: today(), campaign: 'p7-b', count: 1 },
      ])
    } finally {
      delete process.env.SMTP_URL
      delete process.env.BACKEND_URL
    }
  })

  it('counts new OAuth accounts, not existing ones signing in', async () => {
    const tokeninfo = 'https://www.googleapis.com/oauth2/v3/tokeninfo'
    const google = (token: string, email: string) =>
      axiosMock.onGet(`${tokeninfo}?id_token=${token}`).reply(200, {
        aud: WEB_CLIENT,
        name: email,
        email,
        email_verified: 'true',
      })
    google('old', 'a@todorant.com')
    google('new', 'g@todorant.com')
    // a@todorant.com exists already
    await post('google', { accessToken: 'old', campaign: 'p7-a' }).expect(200)
    await post('google', { accessToken: 'new', campaign: 'p7-a' }).expect(200)
    await post('google', { accessToken: 'new', campaign: 'p7-a' }).expect(200)
    // The web's Google button (an access token)
    axiosMock
      .onGet(`${tokeninfo}?access_token=web`)
      .reply(200, { aud: WEB_CLIENT })
    let next = 'b@todorant.com'
    axiosMock
      .onGet('https://www.googleapis.com/oauth2/v3/userinfo')
      .reply(() => [200, { name: next, email: next, email_verified: true }])
    await post('google-firebase', {
      accessToken: 'web',
      campaign: 'p7-g',
    }).expect(200)
    next = 'gf@todorant.com'
    for (let i = 0; i < 2; i++)
      await post('google-firebase', {
        accessToken: 'web',
        campaign: 'p7-g',
      }).expect(200)
    // Facebook
    process.env.FACEBOOK_APP_SECRET = 'fb-secret'
    for (const fb of [
      { id: 'fb-old', email: 'a@todorant.com' },
      { id: 'fb-new', email: 'fb@todorant.com' },
      { id: 'fb-new', email: 'fb@todorant.com' },
    ]) {
      facebookApiSpy.mockImplementationOnce(
        (_: string, done: (e: null, u: unknown) => void) =>
          done(null, { ...fb, name: 'F' })
      )
      await post('facebook', {
        accessToken: 'fb-token',
        campaign: 'p7-f',
      }).expect(200)
    }
    delete process.env.FACEBOOK_APP_SECRET
    // Telegram signs its own fields; the campaign next to them doesn't break the signature
    process.env.TELEGRAM_LOGIN_TOKEN = 'bot-token'
    const data: Record<string, string> = {
      id: '4242',
      first_name: 'T',
      auth_date: String(Math.floor(Date.now() / 1000) - 60),
    }
    const check = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n')
    const key = createHash('sha256').update('bot-token').digest()
    const signed = {
      ...data,
      hash: createHmac('sha256', key).update(check).digest('hex'),
    }
    await post('telegram', { ...signed, campaign: 'p7-t' }).expect(200)
    await post('telegram', { ...signed, campaign: 'p7-t' }).expect(200)
    delete process.env.TELEGRAM_LOGIN_TOKEN
    // Apple via the web
    const apple = jwt.sign(
      { sub: 'apple-new', aud: 'com.todorant.web', email: 'ap@example.com' },
      mockApple.privateKey,
      { algorithm: 'RS256', keyid: 'k' }
    )
    for (let i = 0; i < 2; i++)
      await post('apple-firebase', {
        credential: { oauthIdToken: apple },
        campaign: 'p7-c',
      }).expect(200)
    expect(await counts()).toEqual([
      { day: today(), campaign: 'p7-a', count: 1 },
      { day: today(), campaign: 'p7-c', count: 1 },
      { day: today(), campaign: 'p7-f', count: 1 },
      { day: today(), campaign: 'p7-g', count: 1 },
      { day: today(), campaign: 'p7-t', count: 1 },
    ])
  })
})
