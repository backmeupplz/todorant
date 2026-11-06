import '@/sockets'
import * as randToken from 'rand-token'
import * as request from 'supertest'
import { AddressInfo } from 'net'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Server } from 'http'
import { UserModel } from '@/models/user'
import { apiVersion } from '@/sockets/apiVersion'
import { app } from '@/app'
import { dropMongo, startKoa, stopServer } from '@/__tests__/testUtils'
import { omit } from 'lodash'
import { runMongo, stopMongo } from '@/models/index'
import { sign } from '@/helpers/jwt'
import { socketServer } from '@/sockets/io'

// socket.io 2.5.1 pins it as its own dependency (and ships no typings for it)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ioClient = require('socket.io-client')

type Client = {
  on(event: string, listener: (...args: any[]) => void): void
  once(event: string, listener: (...args: any[]) => void): void
  emit(event: string, ...args: unknown[]): void
  close(): void
}

/** All another account may see of a delegate or delegator */
const counterpartKeys = ['_id', 'name', 'updatedAt']

describe('v1 user push and delegate privacy', () => {
  let url: string
  let server: Server
  const clients: Client[] = []

  beforeAll(async () => {
    const mongoServer = new MongoMemoryServer()
    await runMongo(await mongoServer.getUri())
    await new Promise<void>((res) =>
      socketServer.listen(0, '127.0.0.1', () => res())
    )
    url = `http://127.0.0.1:${(socketServer.address() as AddressInfo).port}`
    server = await startKoa(app)
  })

  beforeEach(async () => {
    await dropMongo()
  })

  afterEach(() => {
    clients.splice(0).forEach((c) => c.close())
  })

  afterAll(async () => {
    await stopServer(server)
    await new Promise((res) => socketServer.close(res))
    await stopMongo()
  })

  async function createUser(name: string, email: string, extra = {}) {
    return UserModel.create({
      name,
      email,
      token: await sign({ name, email }),
      delegateInviteToken: randToken.generate(16),
      anonymousToken: randToken.generate(16),
      passwordLogin: email,
      passwordHash: 'hash',
      ...extra,
    })
  }

  async function connect(token: string) {
    const socket: Client = ioClient(url, { transports: ['websocket'] })
    clients.push(socket)
    await new Promise<void>((res, rej) => {
      socket.once('authorized', () => res())
      socket.once('connect_error', rej)
      socket.once('connect', () =>
        socket.emit('authorize', token, `${apiVersion}`)
      )
    })
    return socket
  }

  function push(socket: Client, name: string, objects: unknown) {
    const syncId = randToken.generate(8)
    return new Promise<any>((res, rej) => {
      socket.on(`${name}_pushed`, (pushed, id) => id === syncId && res(pushed))
      socket.on(`${name}_sync_error`, (err, id) => id === syncId && rej(err))
      socket.emit(`push_${name}`, syncId, objects)
    })
  }

  function pull(socket: Client, name: string, lastSyncDate?: Date) {
    const syncId = randToken.generate(8)
    return new Promise<any>((res, rej) => {
      socket.on(name, (objects, id) => id === syncId && res(objects))
      socket.on(`${name}_sync_error`, (err, id) => id === syncId && rej(err))
      socket.emit(`sync_${name}`, lastSyncDate, syncId)
    })
  }

  const raw = async (id: unknown) =>
    UserModel.collection.findOne({ _id: id }) as Promise<Record<string, any>>

  const pushes: [string, (other: any) => Record<string, unknown>][] = [
    [
      'a whole new _doc with isNew (the insert path)',
      (other) => ({
        _doc: {
          _id: '5f0000000000000000000001',
          name: 'Injected',
          email: 'victim@example.com',
          token: 'chosen-token',
          delegates: [other._id.toString()],
          delegateInviteToken: 'chosen-invite-token',
          settings: {},
          timezone: 0,
          telegramZen: false,
          __v: 0,
        },
        isNew: true,
      }),
    ],
    [
      "mongoose's internal state",
      () => ({ $__: { isNew: true }, $isNew: true, $locals: { x: 1 } }),
    ],
    [
      'private and server-owned fields',
      (other) => ({
        email: 'victim@example.com',
        token: 'chosen-token',
        anonymousToken: 'chosen-anonymous-token',
        appleSubId: 'apple-sub',
        telegramId: '123',
        facebookId: '456',
        passwordLogin: 'victim@example.com',
        passwordHash: 'chosen-hash',
        delegates: [other._id.toString()],
        delegatesUpdatedAt: new Date(0),
        delegateInviteToken: other.delegateInviteToken,
        settings: { language: 'ru' },
        timezone: 5,
        telegramZen: true,
        telegramLanguage: 'ru',
        createdAt: new Date(0),
      }),
    ],
  ]

  it.each(pushes)('push_user only takes the name: %s', async (_, extra) => {
    const other = await createUser('Other', 'other@example.com')
    const user = await createUser('User', 'user@example.com')
    const before = await raw(user._id)
    const otherBefore = await raw(other._id)
    const socket = await connect(user.token)

    const pushed = await push(socket, 'user', {
      ...(user.stripped(true, false) as object),
      ...extra(other),
      name: 'Renamed',
    })

    expect(pushed.name).toBe('Renamed')
    expect(pushed.email).toBe('user@example.com')
    expect(await UserModel.countDocuments()).toBe(2)
    expect(await UserModel.countDocuments({ name: 'Injected' })).toBe(0)
    expect(await UserModel.countDocuments({ token: 'chosen-token' })).toBe(0)
    const after = await raw(user._id)
    expect(after.name).toBe('Renamed')
    // Nothing but the name (and the timestamps a save keeps) changed
    const rest = (doc: Record<string, any>) =>
      omit(doc, ['name', 'updatedAt', '__v'])
    expect(rest(after)).toEqual(rest(before))
    expect(await raw(other._id)).toEqual(otherBefore)
  })

  it('push_user ignores a name that is not a non-empty string', async () => {
    const user = await createUser('User', 'user@example.com')
    const socket = await connect(user.token)

    for (const name of [{ $gt: '' }, ['Array'], 42, '   ', null]) {
      const pushed = await push(socket, 'user', { name })
      expect(pushed.name).toBe('User')
      expect((await raw(user._id)).name).toBe('User')
    }
  })

  it('push_user trims and caps the name like v2', async () => {
    const user = await createUser('User', 'user@example.com')
    const socket = await connect(user.token)

    expect((await push(socket, 'user', { name: '  Renamed  ' })).name).toBe(
      'Renamed'
    )
    expect((await raw(user._id)).name).toBe('Renamed')
    await push(socket, 'user', { name: 'x'.repeat(300) })
    expect((await raw(user._id)).name).toBe('x'.repeat(250))
  })

  it("the delegate pull shows neither side the other's private fields", async () => {
    const delegate = await createUser('Delegate', 'delegate@example.com')
    const delegator = await createUser('Delegator', 'delegator@example.com', {
      delegates: [delegate._id],
    })

    // No sync date: the full list; then one after delegatesUpdatedAt: only the counterparts updated since
    for (const incremental of [false, true]) {
      let date: Date | undefined
      if (incremental) {
        date = new Date()
        await UserModel.collection.updateMany(
          {},
          {
            $set: {
              delegatesUpdatedAt: new Date(0),
              updatedAt: new Date(Date.now() + 60_000),
            },
          }
        )
      }
      {
        const delegatorPull = await pull(
          await connect(delegator.token),
          'delegate',
          date
        )
        expect(delegatorPull.token).toBe(delegator.delegateInviteToken)
        expect(delegatorPull.delegates).toHaveLength(1)
        expect(Object.keys(delegatorPull.delegates[0]).sort()).toEqual(
          counterpartKeys
        )
        expect(delegatorPull.delegates[0]._id).toBe(delegate._id.toString())
        expect(delegatorPull.delegates[0].name).toBe('Delegate')
        expect(JSON.stringify(delegatorPull)).not.toContain(
          delegate.delegateInviteToken
        )
        expect(JSON.stringify(delegatorPull)).not.toContain(
          delegate.anonymousToken
        )

        const delegatePull = await pull(
          await connect(delegate.token),
          'delegate',
          date
        )
        expect(delegatePull.token).toBe(delegate.delegateInviteToken)
        expect(delegatePull.delegators).toHaveLength(1)
        expect(Object.keys(delegatePull.delegators[0]).sort()).toEqual(
          counterpartKeys
        )
        expect(delegatePull.delegators[0].name).toBe('Delegator')
        expect(JSON.stringify(delegatePull)).not.toContain(
          delegator.delegateInviteToken
        )
        expect(JSON.stringify(delegatePull)).not.toContain(
          delegator.anonymousToken
        )
      }
    }
  })

  it("accepting an invite over the socket echoes only the delegator's public fields", async () => {
    const delegator = await createUser('Delegator', 'delegator@example.com')
    const delegate = await createUser('Delegate', 'delegate@example.com')
    const socket = await connect(delegate.token)

    const pushed = await push(socket, 'delegate', {
      delegators: [{ delegateInviteToken: delegator.delegateInviteToken }],
      delegates: [],
    })

    expect(pushed.delegators).toHaveLength(1)
    const echoed = pushed.delegators[0]
    expect(echoed._id).toBe(delegator._id.toString())
    expect(echoed.name).toBe('Delegator')
    expect(echoed.anonymousToken).toBeUndefined()
    expect(echoed.passwordLogin).toBeUndefined()
    expect(echoed.delegatesUpdatedAt).toBeUndefined()
    expect(JSON.stringify(pushed)).not.toContain(delegator.anonymousToken)
    expect((await raw(delegator._id)).delegates.map(String)).toEqual([
      delegate._id.toString(),
    ])
  })

  it("the REST delegate info shows neither side the other's private fields", async () => {
    const delegate = await createUser('Delegate', 'delegate@example.com')
    const delegator = await createUser('Delegator', 'delegator@example.com', {
      delegates: [delegate._id],
    })

    const delegatorInfo = (
      await request(server)
        .get('/delegate')
        .set('token', delegator.token)
        .expect(200)
    ).body
    expect(delegatorInfo.token).toBe(delegator.delegateInviteToken)
    expect(delegatorInfo.delegates).toHaveLength(1)
    expect(Object.keys(delegatorInfo.delegates[0]).sort()).toEqual(
      counterpartKeys
    )
    expect(JSON.stringify(delegatorInfo)).not.toContain(
      delegate.delegateInviteToken
    )

    const delegateInfo = (
      await request(server)
        .get('/delegate')
        .set('token', delegate.token)
        .expect(200)
    ).body
    expect(delegateInfo.delegators).toHaveLength(1)
    expect(Object.keys(delegateInfo.delegators[0]).sort()).toEqual(
      counterpartKeys
    )
    expect(JSON.stringify(delegateInfo)).not.toContain(
      delegator.delegateInviteToken
    )
  })
})
