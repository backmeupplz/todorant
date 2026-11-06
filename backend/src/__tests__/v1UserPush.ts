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

describe('v1 user push', () => {
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

  async function createUser(name: string, email: string) {
    return UserModel.create({
      name,
      email,
      token: await sign({ name, email }),
      delegateInviteToken: randToken.generate(16),
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

  function push(socket: Client, user: object) {
    const syncId = randToken.generate(8)
    return new Promise<any>((res, rej) => {
      socket.on('user_pushed', (pushed, id) => id === syncId && res(pushed))
      socket.on('user_sync_error', (err, id) => id === syncId && rej(err))
      socket.emit('push_user', syncId, user)
    })
  }

  it("keeps the stored invite token when a client pushes another account's", async () => {
    const other = await createUser('Other', 'other@example.com')
    const user = await createUser('User', 'user@example.com')
    const socket = await connect(user.token)

    const pushed = await push(socket, {
      ...(user.stripped(true, false) as object),
      name: 'Renamed',
      delegateInviteToken: other.delegateInviteToken,
    })

    expect(pushed.name).toBe('Renamed')
    expect(pushed.delegateInviteToken).toBe(user.delegateInviteToken)
    const stored = await UserModel.collection.findOne({ _id: user._id })
    expect(stored.name).toBe('Renamed')
    expect(stored.delegateInviteToken).toBe(user.delegateInviteToken)
  })

  it('keeps the stored invite token when a client pushes an empty one', async () => {
    const user = await createUser('User', 'user@example.com')
    const socket = await connect(user.token)

    for (const delegateInviteToken of [null, '']) {
      const pushed = await push(socket, {
        ...(user.stripped(true, false) as object),
        delegateInviteToken,
      })
      expect(pushed.delegateInviteToken).toBe(user.delegateInviteToken)
      expect(
        (await UserModel.collection.findOne({ _id: user._id }))
          .delegateInviteToken
      ).toBe(user.delegateInviteToken)
    }
  })
})
