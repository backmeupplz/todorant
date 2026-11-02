// Shared by the v2 test files (split so jest runs them at once): mocks, server, users and socket helpers
import * as WebSocket from 'ws'
import * as randToken from 'rand-token'
import * as request from 'supertest'
import { AddressInfo } from 'net'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ObjectId } from 'mongodb'
import { Server } from 'http'
import { UserModel } from '@/models/user'
import { app } from '@/app'
import { attachWebSocket } from '@/v2/ws'
import { dropMongo, startKoa, stopServer } from '@/__tests__/testUtils'
import { ensureIndexes } from '@/v2/indexes'
import { generateKeyPairSync } from 'crypto'
import { runMongo, stopMongo } from '@/models/index'
import { sign } from '@/helpers/jwt'
import MockAdapter from 'axios-mock-adapter'
import axios from 'axios'

// The shared CI runner can be busy: setup (drop, indexes, two users) took over 20 s under load
jest.setTimeout(60000)

// Apple's signing keys, without the network
export const mockApple = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
jest.mock('jwks-rsa', () => () => ({
  getSigningKey: (_: string, done: (e: null, key: unknown) => void) =>
    done(null, { publicKey: mockApple.publicKey }),
}))
// Emails land here instead of an SMTP server
export const mockMail: { to: string; text: string }[] = []
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: async (mail: { to: string; text: string }) => mockMail.push(mail),
  }),
}))
export const WEB_CLIENT =
  '167486246043-304ktl4ng8njc185ov1f7vdoafj4gke8.apps.googleusercontent.com'

export const id = () => new ObjectId().toHexString()
export const day = { monthAndYear: '2026-10', date: '13' }

export let server: Server
export let a: { token: string; _id: string }
export let b: { token: string; _id: string }
export const sync = (token: string, body: unknown) =>
  request(server)
    .post('/v2/sync')
    .set('authorization', `Bearer ${token}`)
    .send(body)
    .expect(200)
    .then((r) => r.body)

export async function user(email: string) {
  const token = await sign({ email })
  const doc = await UserModel.create({
    name: email,
    email,
    token,
    delegateInviteToken: randToken.generate(16),
  })
  return { token, _id: String(doc._id) }
}

export const url = () =>
  `ws://localhost:${(server.address() as AddressInfo).port}`

export function socket(
  token: string,
  connect = (base: string) => new WebSocket(`${base}/v2/ws?token=${token}`)
) {
  const ws = connect(url())
  const messages: any[] = []
  ws.on('message', (data) => messages.push(JSON.parse(String(data))))
  // Resolves on the first matching message, received or still to come (no deadline but the test's own)
  const until = (test: (m: any) => boolean) =>
    new Promise<any>((resolve) => {
      const check = () => {
        const found = messages.find(test)
        if (!found) return
        ws.off('message', check)
        resolve(found)
      }
      ws.on('message', check)
      check()
    })
  return { ws, messages, until, ready: until((m) => m.t === 'hello') }
}

export const axiosMock = new MockAdapter(axios)

/** The server, database and two users every v2 test file starts from */
export function setupV2() {
  beforeAll(async () => {
    const mongo = new MongoMemoryServer()
    await runMongo(await mongo.getUri())
    server = await startKoa(app)
    attachWebSocket(server)
  })
  beforeEach(async () => {
    await dropMongo()
    await ensureIndexes()
    a = await user('a@todorant.com')
    b = await user('b@todorant.com')
  })
  afterAll(async () => {
    axiosMock.restore()
    await stopMongo()
    await stopServer(server)
  })
}
