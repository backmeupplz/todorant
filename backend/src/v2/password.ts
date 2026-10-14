import * as Router from 'koa-router'
import * as randToken from 'rand-token'
import { Context } from 'koa'
import {
  DocumentType,
  getModelForClass,
  index,
  prop,
} from '@typegoose/typegoose'
import { User, UserModel } from '@/models/user'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { createTransport } from 'nodemailer'
import { sign } from '@/helpers/jwt'

/**
 * Email + password accounts, mainly for self-hosted servers without OAuth apps. The address lives in
 * `passwordLogin`, never in `email`: OAuth sign-ins find accounts by email, so an unverified address
 * registered here could otherwise receive someone's later Google/Apple sign-in (account pre-hijacking).
 */
const hash = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  )

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64')}$${(
    await hash(password, salt)
  ).toString('base64')}`
}

export async function checkPassword(password: string, stored?: string) {
  const [kind, salt, key] = (stored || '').split('$')
  if (kind !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = await hash(password, Buffer.from(salt, 'base64'))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Failed sign-ins per address and per IP: 10 per 15 minutes, then wait
const WINDOW = 15 * 60 * 1000
const failures = new Map<string, { count: number; since: number }>()
const blocked = (key: string) => {
  const entry = failures.get(key)
  return !!entry && Date.now() - entry.since < WINDOW && entry.count >= 10
}
const fail = (key: string) => {
  const entry = failures.get(key)
  if (!entry || Date.now() - entry.since >= WINDOW)
    failures.set(key, { count: 1, since: Date.now() })
  else entry.count++
}
setInterval(() => {
  for (const [key, { since }] of failures)
    if (Date.now() - since >= WINDOW) failures.delete(key)
}, 60000).unref()

/**
 * With SMTP_URL set, a sign-up only emails a link: the account exists once the link is opened. Without it
 * (self-hosted servers on a home network) sign-up creates the account right away
 */
// updatedAt: signing up again sends a new link, good for another 24 hours
@index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 })
class PendingSignup {
  @prop({ required: true, unique: true })
  login: string
  @prop({ required: true })
  passwordHash: string
  @prop({ required: true })
  name: string
  /** sha256 of the token in the emailed link */
  @prop({ required: true, index: true })
  tokenHash: string
}
const PendingSignupModel = getModelForClass(PendingSignup, {
  schemaOptions: { timestamps: true },
})
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const mailer = () =>
  process.env.SMTP_URL
    ? createTransport(process.env.SMTP_URL, { from: process.env.MAIL_FROM })
    : undefined

async function createUser(login: string, passwordHash: string, name: string) {
  const params = {
    name,
    delegateInviteToken: randToken.generate(16),
    passwordLogin: login,
  }
  return (await new UserModel({
    ...params,
    passwordHash,
    token: await sign(params),
  }).save()) as DocumentType<User>
}

const page = (text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Todorant</title>` +
  `<body style="font:18px system-ui,sans-serif;text-align:center;padding:20vh 16px">${text}</body>`

function credentials(ctx: Context) {
  const { email, password } = ctx.request.body as Record<string, unknown>
  if (
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    email.length > 254
  )
    return ctx.throw(400, 'Invalid email')
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 200
  )
    return ctx.throw(400, 'The password needs 8 to 200 characters')
  return { login: email.trim().toLowerCase(), password }
}

export function passwordRoutes(router: Router) {
  router.post('/auth/signup', async (ctx) => {
    if (process.env.PASSWORD_SIGNUP === 'false')
      ctx.throw(403, 'Signing up with a password is disabled on this server')
    const { login, password } = credentials(ctx)
    const name = (ctx.request.body as Record<string, unknown>).name
    if (await UserModel.exists({ passwordLogin: login }))
      ctx.throw(409, 'This email is already registered')
    const displayName =
      typeof name === 'string' && name.trim()
        ? name.trim().slice(0, 250)
        : login.split('@')[0]
    const transport = mailer()
    if (!transport) {
      const user = await createUser(
        login,
        await hashPassword(password),
        displayName
      )
      ctx.body = user.stripped(true)
      return
    }
    // Each sign-up sends an email: limit them per address and per IP
    const keys = [`mail:${login}`, `mail-ip:${ctx.ip}`]
    if (keys.some(blocked)) ctx.throw(429, 'Too many attempts, try again later')
    keys.forEach(fail)
    const token = randomBytes(32).toString('hex')
    await PendingSignupModel.findOneAndUpdate(
      { login },
      {
        passwordHash: await hashPassword(password),
        name: displayName,
        tokenHash: sha256(token),
      },
      { upsert: true }
    )
    // From config, never the request's Host: a forged one would send the victim's link to another site
    const base = process.env.BACKEND_URL || process.env.TODORANT_API
    if (!base)
      throw new Error('Set BACKEND_URL for the links in sign-up emails')
    const link = `${base.replace(/\/$/, '')}/v2/auth/verify?token=${token}`
    await transport.sendMail({
      to: login,
      subject: 'Confirm your Todorant account',
      text: `Open this link to finish creating your Todorant account:\n\n${link}\n\nThe link works for 24 hours. If you didn't sign up, ignore this email.`,
    })
    // Not a 2xx: the shipped apps parse a 2xx as the account and show the text of any other answer
    ctx.throw(
      403,
      `Almost done: open the link we sent to ${login}, then sign in`
    )
  })

  router.get('/auth/verify', async (ctx) => {
    const token = ctx.query.token
    const pending =
      typeof token === 'string' &&
      (await PendingSignupModel.findOneAndDelete({ tokenHash: sha256(token) }))
    ctx.type = 'html'
    if (!pending) {
      ctx.status = 404
      ctx.body = page(
        'This link has expired or was already used. Sign up again to get a new one.'
      )
      return
    }
    if (!(await UserModel.exists({ passwordLogin: pending.login })))
      await createUser(pending.login, pending.passwordHash, pending.name)
    ctx.body = page('Your email is confirmed. Go back to Todorant and sign in.')
  })

  router.post('/auth/password', async (ctx) => {
    const { login, password } = credentials(ctx)
    const keys = [`login:${login}`, `ip:${ctx.ip}`]
    if (keys.some(blocked)) ctx.throw(429, 'Too many attempts, try again later')
    const user = await UserModel.findOne({ passwordLogin: login })
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      keys.forEach(fail)
      const pending = !user && (await PendingSignupModel.findOne({ login }))
      if (pending && (await checkPassword(password, pending.passwordHash)))
        ctx.throw(
          403,
          `Confirm your email first: open the link we sent to ${login}`
        )
      return ctx.throw(401, 'Wrong email or password')
    }
    ctx.body = user.stripped(true)
  })
}
