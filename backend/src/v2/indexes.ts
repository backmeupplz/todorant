import * as randToken from 'rand-token'
import { CampaignSignupModel } from '@/models/campaignSignup'
import { HeroModel } from '@/models/hero'
import { ObjectId } from 'mongodb'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { UserModel, inviteTokenIndexFilter } from '@/models/user'

/**
 * Compound indexes for every v2 (and the hot v1) query. Built in the background on startup;
 * createIndex is a no-op when an index already exists.
 */
export function ensureIndexes() {
  const background = { background: true }
  return Promise.all([
    // Delta pulls for both sides of delegation
    TodoModel.collection.createIndex({ user: 1, updatedAt: 1 }, background),
    TodoModel.collection.createIndex(
      { delegator: 1, updatedAt: 1 },
      {
        ...background,
        partialFilterExpression: { delegator: { $exists: true } },
      }
    ),
    // Day lists, current todo, planning/completed pages, v1's per-user scans
    TodoModel.collection.createIndex(
      { user: 1, completed: 1, monthAndYear: 1, date: 1, frog: -1, order: 1 },
      background
    ),
    // v1 WatermelonDB pushes match by client id
    TodoModel.collection.createIndex(
      { user: 1, clientId: 1 },
      {
        ...background,
        partialFilterExpression: { clientId: { $exists: true } },
      }
    ),
    TagModel.collection.createIndex({ user: 1, updatedAt: 1 }, background),
    TagModel.collection.createIndex(
      { user: 1, deleted: 1, tag: 1 },
      background
    ),
    HeroModel.collection.createIndex({ user: 1 }, background),
    UserModel.collection.createIndex({ delegates: 1 }, background),
    // The schema's unique index never got built in production because accounts already shared
    // tokens: repair them and store tokens for accounts without one first, then build it (the
    // same spec mongoose's autoIndex uses)
    dedupeDelegateInviteTokens()
      .then(backfillDelegateInviteTokens)
      .then(ensureInviteTokenIndex),
    // One counter per day and campaign
    CampaignSignupModel.collection.createIndex(
      { day: 1, campaign: 1 },
      { ...background, unique: true }
    ),
  ])
}

/** The unique index on invite tokens, replacing one with other options (older schemas built it unconditionally unique) */
async function ensureInviteTokenIndex() {
  const name = 'delegateInviteToken_1'
  const indexes = await UserModel.collection
    .indexes()
    // No collection yet (a new database): nothing to replace
    .catch((error) => {
      if (error?.code === 26) return []
      throw error
    })
  const existing = indexes.find((index) => index.name === name)
  if (
    existing &&
    (!existing.unique ||
      JSON.stringify(existing.partialFilterExpression) !==
        JSON.stringify(inviteTokenIndexFilter))
  ) {
    await UserModel.collection.dropIndex(name)
  }
  await UserModel.collection.createIndex(
    { delegateInviteToken: 1 },
    {
      background: true,
      unique: true,
      partialFilterExpression: inviteTokenIndexFilter,
    }
  )
}

/**
 * Gives a fresh invite token to every account that shares one with an older account. The schema
 * default used to be a single value per process, so accounts created without an explicit token
 * shared it. An invite lookup returns the oldest holder, so links shared today already reach that
 * account: it keeps the token, and the others (whose links reached someone else) get new ones.
 * Returns how many accounts got a new token.
 */
export async function dedupeDelegateInviteTokens() {
  const groups = await UserModel.collection
    .aggregate<{ _id: string; ids: ObjectId[] }>(
      [
        { $match: inviteTokenIndexFilter },
        {
          $group: {
            _id: '$delegateInviteToken',
            n: { $sum: 1 },
            ids: { $push: '$_id' },
          },
        },
        { $match: { n: { $gt: 1 } } },
      ],
      { allowDiskUse: true }
    )
    .toArray()
  let rotated = 0
  for (const { _id: shared, ids } of groups) {
    // Hex ObjectIds have a fixed length, so string order is creation order
    const [, ...newer] = ids.sort((a, b) =>
      a.toHexString().localeCompare(b.toHexString())
    )
    for (const _id of newer) {
      // Only while it still has the shared token: one regenerated meanwhile is already unique.
      // updatedAt so clients pull the new token
      const { modifiedCount } = await UserModel.collection.updateOne(
        { _id, delegateInviteToken: shared },
        {
          $set: {
            delegateInviteToken: randToken.generate(16),
            updatedAt: new Date(),
          },
        }
      )
      rotated += modifiedCount
    }
  }
  if (rotated)
    console.log(`Gave ${rotated} accounts a new delegate invite token`)
  return rotated
}

/**
 * Stores a token for every account without one: accounts from before invites, and v1 pushes that
 * wrote null. Every reader then shows a stored token (mongoose would otherwise make one up for each
 * load). Only while it still has none, so a token stored meanwhile stays. Returns how many got one
 */
export async function backfillDelegateInviteTokens() {
  const missing = { $not: inviteTokenIndexFilter.delegateInviteToken }
  const ids = (
    await UserModel.collection
      .find({ delegateInviteToken: missing }, { projection: { _id: 1 } })
      .toArray()
  ).map(({ _id }) => _id)
  let filled = 0
  for (let i = 0; i < ids.length; i += 1000) {
    const now = new Date()
    const { modifiedCount } = await UserModel.collection.bulkWrite(
      ids.slice(i, i + 1000).map((_id) => ({
        updateOne: {
          filter: { _id, delegateInviteToken: missing },
          // updatedAt so clients pull the token
          update: {
            $set: {
              delegateInviteToken: randToken.generate(16),
              updatedAt: now,
            },
          },
        },
      })),
      { ordered: false }
    )
    filled += modifiedCount
  }
  if (filled)
    console.log(`Stored a delegate invite token for ${filled} accounts`)
  return filled
}
