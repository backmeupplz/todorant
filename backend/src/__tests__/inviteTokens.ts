import { MongoMemoryServer } from 'mongodb-memory-server'
import { ObjectId } from 'mongodb'
import { UserModel } from '@/models/user'
import {
  backfillDelegateInviteTokens,
  dedupeDelegateInviteTokens,
  ensureIndexes,
} from '@/v2/indexes'
import { dropMongo } from '@/__tests__/testUtils'
import { runMongo, stopMongo } from '@/models/index'

describe('Delegate invite tokens', () => {
  beforeAll(async () => {
    const mongoServer = new MongoMemoryServer()
    await runMongo(await mongoServer.getUri())
    // Wait for mongoose's own index build so dropping it below can't race it
    await UserModel.init()
  })

  beforeEach(async () => {
    await dropMongo()
  })

  afterAll(async () => {
    await stopMongo()
  })

  it('gives every new account its own token', async () => {
    const one = await new UserModel({ name: 'One', token: 'one' }).save()
    const two = await new UserModel({ name: 'Two', token: 'two' }).save()
    expect(one.delegateInviteToken).toMatch(/^[a-zA-Z0-9]{16}$/)
    expect(two.delegateInviteToken).toMatch(/^[a-zA-Z0-9]{16}$/)
    expect(one.delegateInviteToken).not.toBe(two.delegateInviteToken)
  })

  it("doesn't make up a token when it loads an account without one", async () => {
    // Mongoose applies defaults on load too: a token made up there is shown but never stored
    const { insertedId } = await UserModel.collection.insertOne({
      name: 'Old',
      token: 'old',
    })
    expect((await UserModel.findById(insertedId)).delegateInviteToken).toBe(
      undefined
    )
    expect(
      (await UserModel.collection.findOne({ _id: insertedId }))
        .delegateInviteToken
    ).toBeUndefined()
  })

  it('gives an account an upsert creates its own token', async () => {
    for (const name of ['One', 'Two'])
      await UserModel.updateOne(
        { name },
        { $set: { token: name } },
        { upsert: true, setDefaultsOnInsert: true }
      )
    const tokens = (await UserModel.collection.find({}).toArray()).map(
      (u) => u.delegateInviteToken
    )
    expect(tokens).toHaveLength(2)
    for (const token of tokens) expect(token).toMatch(/^[a-zA-Z0-9]{16}$/)
    expect(tokens[0]).not.toBe(tokens[1])
  })

  it('repairs shared tokens, keeping the oldest holder, then enforces uniqueness among real tokens', async () => {
    // Production never got the unique index, so accounts there share tokens
    await UserModel.collection.dropIndex('delegateInviteToken_1')
    const ids = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) => new ObjectId(`65000000000000000000000${i}`)
    )
    const past = new Date('2020-01-01')
    await UserModel.collection.insertMany([
      // Inserted newest first, so creation order isn't insertion order
      {
        _id: ids[2],
        name: 'C',
        token: 'C',
        delegateInviteToken: 'shared',
        updatedAt: past,
      },
      {
        _id: ids[0],
        name: 'A',
        token: 'A',
        delegateInviteToken: 'shared',
        updatedAt: past,
      },
      {
        _id: ids[1],
        name: 'B',
        token: 'B',
        delegateInviteToken: 'shared',
        updatedAt: past,
      },
      {
        _id: ids[3],
        name: 'D',
        token: 'D',
        delegateInviteToken: 'own',
        updatedAt: past,
      },
      // From before invites: no token, and several of them
      { _id: ids[4], name: 'E', token: 'E', updatedAt: past },
      { _id: ids[5], name: 'F', token: 'F', updatedAt: past },
      // v1 pushes can write null
      { _id: ids[6], name: 'G', token: 'G', delegateInviteToken: null },
      { _id: ids[7], name: 'H', token: 'H', delegateInviteToken: null },
    ])

    await ensureIndexes()

    const users = await UserModel.collection
      .find({}, { sort: { _id: 1 } })
      .toArray()
    const token = (i: number) => users[i].delegateInviteToken
    expect(token(0)).toBe('shared')
    expect(users[0].updatedAt).toEqual(past)
    for (const i of [1, 2]) {
      expect(token(i)).toMatch(/^[a-zA-Z0-9]{16}$/)
      expect(users[i].updatedAt.getTime()).toBeGreaterThan(past.getTime())
    }
    expect(token(1)).not.toBe(token(2))
    expect(token(3)).toBe('own')
    expect(users[3].updatedAt).toEqual(past)
    // Accounts without a token get their own stored one
    for (const i of [4, 5, 6, 7]) {
      expect(token(i)).toMatch(/^[a-zA-Z0-9]{16}$/)
      expect(users[i].updatedAt.getTime()).toBeGreaterThan(past.getTime())
    }
    expect(new Set(users.map((u) => u.delegateInviteToken)).size).toBe(8)

    const index = (await UserModel.collection.indexes()).find(
      (i) => i.name === 'delegateInviteToken_1'
    )
    expect(index).toMatchObject({
      unique: true,
      partialFilterExpression: { delegateInviteToken: { $gt: '' } },
    })
    await expect(
      UserModel.collection.insertOne({
        name: 'I',
        token: 'I',
        delegateInviteToken: 'own',
      })
    ).rejects.toThrow('E11000')
    // Nothing left to repair
    expect(await dedupeDelegateInviteTokens()).toBe(0)
    expect(await backfillDelegateInviteTokens()).toBe(0)
    // Invites look accounts up by token through the index
    const plan = await UserModel.collection
      .find({ delegateInviteToken: 'own' })
      .explain()
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('IXSCAN')
  })

  it('replaces an unconditionally unique index from older schemas', async () => {
    await UserModel.collection.dropIndex('delegateInviteToken_1')
    await UserModel.collection.createIndex(
      { delegateInviteToken: 1 },
      { unique: true }
    )
    await UserModel.collection.insertOne({ name: 'A', token: 'A' })

    await ensureIndexes()

    const index = (await UserModel.collection.indexes()).find(
      (i) => i.name === 'delegateInviteToken_1'
    )
    expect(index.partialFilterExpression).toEqual({
      delegateInviteToken: { $gt: '' },
    })
    // A second account without a token no longer collides with the first
    await UserModel.collection.insertOne({ name: 'B', token: 'B' })
    // And running it again keeps the index
    await ensureIndexes()
    expect(
      (await UserModel.collection.indexes()).some(
        (i) => i.name === 'delegateInviteToken_1'
      )
    ).toBe(true)
  })
})
