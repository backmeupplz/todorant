import * as mongoose from 'mongoose'
import { DocumentType, Ref, getModelForClass, prop } from '@typegoose/typegoose'
import { User, UserModel } from '@/models/user'
import { createHash, randomBytes } from 'crypto'

/** Every API token starts with this; session JWTs (`eyJ…`) never do */
export const API_TOKEN_PREFIX = 'tdr_'
/** Tokens one account may hold at once */
export const MAX_API_TOKENS = 20
/** `lastUsedAt` moves at most this often: a busy client must not write on every request */
const LAST_USED_EVERY = 10 * 60 * 1000

/**
 * Personal API tokens: long-lived, revocable credentials for scripts and third-party tools, so nobody
 * has to copy the session token out of the browser. Only the sha256 is stored: the token itself is
 * shown once, when it's created. They open the same data as a session, but never account-level
 * actions (see `sessionOnly`).
 */
export class ApiToken {
  @prop({ required: true, ref: User, index: true })
  user: Ref<User>
  @prop({ required: true })
  name: string
  /** sha256 of the token (hex): tokens are 256 random bits, so no salt or slow hash is needed */
  @prop({ required: true, unique: true })
  hash: string
  /** The first characters of the token, to tell tokens apart in a list */
  @prop({ required: true })
  prefix: string
  @prop()
  lastUsedAt?: Date

  // Mongo property
  createdAt: Date
}

export const ApiTokenModel = getModelForClass(ApiToken, {
  schemaOptions: { timestamps: { createdAt: true, updatedAt: false } },
})

export const isApiToken = (token: unknown): token is string =>
  typeof token === 'string' && token.startsWith(API_TOKEN_PREFIX)

export const hashApiToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/** Makes a token for [user]; the returned `token` can't be read again */
export async function createApiToken(
  user: mongoose.Types.ObjectId,
  name: string
) {
  const token =
    API_TOKEN_PREFIX +
    randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  const doc = await ApiTokenModel.create({
    user,
    name,
    hash: hashApiToken(token),
    prefix: token.slice(0, API_TOKEN_PREFIX.length + 4),
  })
  return { token, doc }
}

/** The account an API token belongs to, or undefined for an unknown or revoked one */
export async function userOfApiToken(token: string) {
  const doc = await ApiTokenModel.findOne({ hash: hashApiToken(token) })
  if (!doc) return undefined
  const user = (await UserModel.findById(doc.user)) as DocumentType<User> | null
  if (!user) {
    // Its account is gone (merged into another one)
    await ApiTokenModel.deleteOne({ _id: doc._id })
    return undefined
  }
  const stale = new Date(Date.now() - LAST_USED_EVERY)
  if (!doc.lastUsedAt || doc.lastUsedAt < stale)
    // Not awaited and conditional: two requests racing here write once, and a failure costs nothing
    ApiTokenModel.updateOne(
      {
        _id: doc._id,
        $or: [{ lastUsedAt: null }, { lastUsedAt: { $lt: stale } }],
      },
      { $set: { lastUsedAt: new Date() } }
    ).catch(() => undefined)
  return user
}
