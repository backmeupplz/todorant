import '@/sockets'
import * as randToken from 'rand-token'
import { AddressInfo } from 'net'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { UserModel } from '@/models/user'
import { apiVersion } from '@/sockets/apiVersion'
import { dropMongo } from '@/__tests__/testUtils'
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

describe('v1 delegate push', () => {
  let url: string
  let client: Client | undefined

  beforeAll(async () => {
    const mongoServer = new MongoMemoryServer()
    await runMongo(await mongoServer.getUri())
    await new Promise<void>((res) =>
      socketServer.listen(0, '127.0.0.1', () => res())
    )
    url = `http://127.0.0.1:${(socketServer.address() as AddressInfo).port}`
  })

  beforeEach(async () => {
    await dropMongo()
  })

  afterEach(() => {
    client?.close()
    client = undefined
  })

  afterAll(async () => {
    await new Promise((res) => socketServer.close(res))
    await stopMongo()
  })

  async function createUser(name: string, delegates: unknown[] = []) {
    const email = `${name.toLowerCase()}@example.com`
    return UserModel.create({
      name,
      email,
      token: await sign({ name, email }),
      delegateInviteToken: randToken.generate(16),
      delegates,
      // Long ago, so any change to it shows
      delegatesUpdatedAt: new Date(0),
    })
  }

  async function connect(token: string) {
    const socket: Client = ioClient(url, { transports: ['websocket'] })
    client = socket
    await new Promise<void>((res, rej) => {
      socket.once('authorized', () => res())
      socket.once('connect_error', rej)
      socket.once('connect', () =>
        socket.emit('authorize', token, `${apiVersion}`)
      )
    })
    return socket
  }

  function push(
    socket: Client,
    objects: { delegators: object[]; delegates: object[] }
  ) {
    const syncId = randToken.generate(8)
    return new Promise<any>((res, rej) => {
      socket.on('delegate_pushed', (pushed, id) => id === syncId && res(pushed))
      socket.on('delegate_sync_error', (err, id) => id === syncId && rej(err))
      socket.emit('push_delegate', syncId, objects)
    })
  }

  const stored = async (user: { _id: unknown }): Promise<any> =>
    UserModel.collection.findOne({ _id: user._id })
  const ids = (doc: { delegates: unknown[] }) => doc.delegates.map(String)
  const touched = async (user: { _id: unknown }) =>
    (await stored(user)).delegatesUpdatedAt.getTime() > 0

  it('lists the user once when an invite is accepted again', async () => {
    const delegator = await createUser('Delegator')
    const user = await createUser('User')
    const socket = await connect(user.token)
    const accept = { delegateInviteToken: delegator.delegateInviteToken }

    const pushed = await push(socket, { delegators: [accept], delegates: [] })
    expect(pushed.delegators[0].invalid).toBeFalsy()
    expect(String(pushed.delegators[0]._id)).toBe(String(delegator._id))
    const accepted = await stored(delegator)
    expect(ids(accepted)).toEqual([String(user._id)])
    // Both accounts' incremental delegate pulls see the change
    expect(await touched(delegator)).toBe(true)
    expect(await touched(user)).toBe(true)

    // Again, and twice in one push
    await push(socket, { delegators: [{ ...accept }], delegates: [] })
    await push(socket, {
      delegators: [{ ...accept }, { ...accept }],
      delegates: [],
    })
    const again = await stored(delegator)
    expect(ids(again)).toEqual([String(user._id)])
    // Nothing changed for the delegator
    expect(again.delegatesUpdatedAt).toEqual(accepted.delegatesUpdatedAt)
  })

  it('lists the user once when one push accepts an invite twice', async () => {
    const delegator = await createUser('Delegator')
    const user = await createUser('User')
    const socket = await connect(user.token)
    const accept = { delegateInviteToken: delegator.delegateInviteToken }

    const pushed = await push(socket, {
      delegators: [{ ...accept }, { ...accept }],
      delegates: [],
    })
    expect(
      pushed.delegators.map((d: { _id: unknown }) => String(d._id))
    ).toEqual([String(delegator._id), String(delegator._id)])
    expect(ids(await stored(delegator))).toEqual([String(user._id)])
    expect(await touched(delegator)).toBe(true)
    expect(await touched(user)).toBe(true)
  })

  it('still rejects an own or unknown invite', async () => {
    const user = await createUser('User')
    const socket = await connect(user.token)

    const pushed = await push(socket, {
      delegators: [
        { delegateInviteToken: user.delegateInviteToken },
        { delegateInviteToken: 'unknown' },
      ],
      delegates: [],
    })
    expect(
      pushed.delegators.map((d: { invalid?: boolean }) => d.invalid)
    ).toEqual([true, true])
    expect(await touched(user)).toBe(false)
  })

  it('ignores removal ids that are not ObjectId strings', async () => {
    const delegate = await createUser('Delegate')
    const user = await createUser('User', [delegate._id])
    const first = await createUser('First', [user._id])
    const second = await createUser('Second', [user._id])
    const socket = await connect(user.token)

    const operators = [
      { $exists: true },
      { $ne: null },
      { $in: [first._id, second._id] },
      String(first._id).toUpperCase(),
      'not an id',
      123,
      null,
    ]
    await push(socket, {
      delegators: operators.map((_id) => ({ _id, deleted: true })),
      delegates: operators.map((_id) => ({ _id, deleted: true })),
    })

    expect(ids(await stored(user))).toEqual([String(delegate._id)])
    expect(ids(await stored(first))).toEqual([String(user._id)])
    expect(ids(await stored(second))).toEqual([String(user._id)])
    for (const account of [user, first, second, delegate]) {
      expect(await touched(account)).toBe(false)
    }
  })

  it('removes a delegator and a delegate by id', async () => {
    const delegate = await createUser('Delegate')
    const kept = await createUser('Kept')
    const user = await createUser('User', [delegate._id, kept._id])
    const delegator = await createUser('Delegator', [user._id, kept._id])
    const socket = await connect(user.token)

    await push(socket, {
      delegators: [{ _id: String(delegator._id), deleted: true }],
      delegates: [{ _id: String(delegate._id), deleted: true }],
    })

    expect(ids(await stored(user))).toEqual([String(kept._id)])
    expect(ids(await stored(delegator))).toEqual([String(kept._id)])
    for (const account of [user, delegator, delegate]) {
      expect(await touched(account)).toBe(true)
    }
    expect(await touched(kept)).toBe(false)
  })

  it("doesn't touch accounts it isn't linked with", async () => {
    const stranger = await createUser('Stranger')
    const user = await createUser('User')
    const socket = await connect(user.token)

    await push(socket, {
      delegators: [{ _id: String(stranger._id), deleted: true }],
      delegates: [{ _id: String(stranger._id), deleted: true }],
    })

    for (const account of [user, stranger]) {
      expect(await touched(account)).toBe(false)
    }
  })
})
