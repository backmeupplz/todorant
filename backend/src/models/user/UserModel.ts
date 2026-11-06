import * as randToken from 'rand-token'
import { DocumentType, getModelForClass } from '@typegoose/typegoose'
import { ObjectId } from 'mongodb'
import { Todo } from '@/models/todo'
import { User, inviteTokenIndexFilter } from '@/models/user/User'
import { sign } from '@/helpers/jwt'

export const UserModel = getModelForClass(User, {
  schemaOptions: { timestamps: true },
})

/**
 * The account's stored invite token, storing a new one when it has none (an account from before
 * invites, or a v1 push that wrote null). Only sets it while there is none, so concurrent callers
 * all return the one token that got stored. updatedAt so clients pull it
 */
export async function storedInviteToken(id: unknown) {
  const _id = new ObjectId(String(id))
  const token = randToken.generate(16)
  const { modifiedCount } = await UserModel.collection.updateOne(
    {
      _id,
      delegateInviteToken: { $not: inviteTokenIndexFilter.delegateInviteToken },
    },
    { $set: { delegateInviteToken: token, updatedAt: new Date() } }
  )
  if (modifiedCount) return token
  const stored = await UserModel.collection.findOne(
    { _id },
    { projection: { delegateInviteToken: 1 } }
  )
  return stored?.delegateInviteToken as string | undefined
}

interface LoginOptions {
  email?: string
  facebookId?: string
  telegramId?: string
  anonymousToken?: string

  name: string
}

export async function getOrCreateUser(loginOptions: LoginOptions) {
  if (!loginOptions.name) {
    throw new Error()
  }
  let user: DocumentType<User> | undefined
  // Try email
  if (loginOptions.email) {
    user = await UserModel.findOne({ email: loginOptions.email })
  }
  // Try facebook id
  if (!user && loginOptions.facebookId) {
    user = await UserModel.findOne({
      facebookId: loginOptions.facebookId,
    })
  }
  // Try telegram id
  if (!user && loginOptions.telegramId) {
    user = await UserModel.findOne({
      telegramId: loginOptions.telegramId,
    })
  }
  // Try anonymous token
  if (!user && loginOptions.anonymousToken) {
    user = await UserModel.findOne({
      anonymousToken: loginOptions.anonymousToken,
    })
  }
  let created = false
  if (!user) {
    created = true
    // Check if we have credentials
    if (
      !(
        loginOptions.email ||
        loginOptions.facebookId ||
        loginOptions.telegramId ||
        loginOptions.anonymousToken
      )
    ) {
      throw new Error()
    }
    const params = {
      name: loginOptions.name,
      delegateInviteToken: randToken.generate(16),
    } as any
    if (loginOptions.email) {
      params.email = loginOptions.email
    }
    if (loginOptions.facebookId) {
      params.facebookId = loginOptions.facebookId
    }
    if (loginOptions.telegramId) {
      params.telegramId = loginOptions.telegramId
    }
    if (loginOptions.anonymousToken) {
      params.anonymousToken = loginOptions.anonymousToken
    }
    user = (await new UserModel({
      ...params,
      token: await sign(params),
    }).save()) as DocumentType<User>
  }
  return { created, user }
}

export async function sanitizeDelegation(
  clientTodo: Todo,
  user: User,
  serverTodo?: DocumentType<Todo>
) {
  if (!clientTodo.delegator) {
    clientTodo.user = user._id
  } else {
    if (clientTodo.delegator === user._id.toString()) {
      if (!clientTodo.user || !user.delegates.includes(clientTodo.user)) {
        clientTodo.user = user._id
        clientTodo.delegator = undefined
      }
      if (serverTodo && clientTodo.delegateAccepted) {
        serverTodo.updatedAt = new Date()
        await serverTodo.save()
        return true
      }
    } else {
      const delegator = await UserModel.findById(clientTodo.delegator)
      if (!delegator.delegates.includes(user._id)) {
        clientTodo.delegator = undefined
      }
      clientTodo.user = user._id
    }
  }
}
