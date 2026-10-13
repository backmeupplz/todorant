import * as Router from 'koa-router'
import * as randToken from 'rand-token'
import { Context } from 'koa'
import { DocumentType } from '@typegoose/typegoose'
import { User, UserModel } from '@/models/user'
import { randomBytes, scrypt, timingSafeEqual } from 'crypto'
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
    const params = {
      name:
        typeof name === 'string' && name.trim()
          ? name.trim().slice(0, 250)
          : login.split('@')[0],
      delegateInviteToken: randToken.generate(16),
      passwordLogin: login,
    }
    const user = (await new UserModel({
      ...params,
      passwordHash: await hashPassword(password),
      token: await sign(params),
    }).save()) as DocumentType<User>
    ctx.body = user.stripped(true)
  })

  router.post('/auth/password', async (ctx) => {
    const { login, password } = credentials(ctx)
    const keys = [`login:${login}`, `ip:${ctx.ip}`]
    if (keys.some(blocked)) ctx.throw(429, 'Too many attempts, try again later')
    const user = await UserModel.findOne({ passwordLogin: login })
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      keys.forEach(fail)
      return ctx.throw(401, 'Wrong email or password')
    }
    ctx.body = user.stripped(true)
  })
}
