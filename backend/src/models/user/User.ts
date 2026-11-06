import * as randToken from 'rand-token'
import { Ref, prop } from '@typegoose/typegoose'
import { omit } from 'lodash'

export interface Settings {
  showTodayOnAddTodo?: boolean
  firstDayOfWeek?: number
  startTimeOfDay?: string
  newTodosGoFirst?: boolean
  preserveOrderByTime?: boolean
  duplicateTagInBreakdown?: boolean
  showMoreByDefault?: boolean
  updatedAt?: Date
  language?: string
}

export enum TelegramLanguage {
  en = 'en',
  ru = 'ru',
  it = 'it',
  ua = 'ua',
}

/**
 * The invite tokens the unique index covers: non-empty strings. `$gt: ''` rather than `$type`, so
 * an equality lookup by token can use the index (it leaves out missing and null tokens either way)
 */
export const inviteTokenIndexFilter = { delegateInviteToken: { $gt: '' } }

export class User {
  @prop({ index: true, lowercase: true })
  email?: string
  @prop({ index: true, lowercase: true })
  facebookId?: string
  @prop({ index: true, lowercase: true })
  telegramId?: string
  @prop({ index: true })
  anonymousToken?: string
  @prop({ index: true, lowercase: true })
  appleSubId?: string
  /** Email of an email+password account (kept apart from `email`, which OAuth sign-ins match on) */
  @prop({ index: true, unique: true, sparse: true, lowercase: true })
  passwordLogin?: string
  @prop()
  passwordHash?: string
  @prop({ required: true, index: true })
  name: string
  @prop({
    required: true,
    default: { preserveOrderByTime: true },
    _id: false,
  })
  settings: Settings

  @prop({ required: true, index: true, unique: true })
  token: string

  @prop({ required: true, default: 0 })
  timezone: number
  @prop({ required: true, default: false })
  telegramZen: boolean
  @prop({ enum: TelegramLanguage, index: true })
  telegramLanguage?: TelegramLanguage

  // Defaults are functions so each new document gets its own value: a plain value is computed once
  // when this file loads and every account created by the process would share it. The token is
  // only made up for a new account: mongoose also applies defaults to a loaded document that lacks
  // the field, and a token invented there is shown but never stored (storedInviteToken stores one).
  // Unique among real tokens only: accounts from before invites had none (and v1 pushes may write
  // null). ensureIndexes builds this same index in production
  @prop({
    index: { unique: true, partialFilterExpression: inviteTokenIndexFilter },
    // No document for an upsert's insert defaults: that's a new account too
    default: function (this: { isNew?: boolean } | null) {
      return !this || this.isNew ? randToken.generate(16) : undefined
    },
  })
  delegateInviteToken?: string
  @prop({ ref: User, required: true, default: [], index: true })
  delegates: Ref<User>[]
  @prop({ default: () => new Date() })
  delegatesUpdatedAt: Date

  stripped(withExtra = false, withToken = true) {
    const stripFields = [
      '__v',
      'todos',
      'delegates',
      'settingsFts',
      'passwordHash',
    ]
    if (!withExtra) {
      stripFields.push('token')
      stripFields.push('email')
      stripFields.push('facebookId')
      stripFields.push('telegramId')
      stripFields.push('appleSubId')
      stripFields.push('timezone')
      stripFields.push('settings')
      stripFields.push('createdAt')
      stripFields.push('telegramZen')
    }
    if (!withToken) {
      stripFields.push('token')
      stripFields.push('anonymousToken')
    }
    return omit(this._doc, stripFields) as unknown
  }

  // Mongo property
  updatedAt: Date
  _id: string
  _doc: any
  createdAt: Date
}
