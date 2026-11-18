// The real jwks-rsa and apple-auth (the other suites mock them) against local keys,
// so a dependency bump that breaks Sign in with Apple fails here
import * as jwt from 'jsonwebtoken'
import { createPublicKey, generateKeyPairSync } from 'crypto'
import { parse } from 'querystring'
import { verifyAppleToken } from '@/helpers/jwt'
import MockAdapter from 'axios-mock-adapter'
import axios from 'axios'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppleAuth = require('apple-auth')

const mock = new MockAdapter(axios)
afterAll(() => mock.restore())

describe('verifyAppleToken', () => {
  // PEM strings: the repo's @types (node 14, jsonwebtoken 8) predate KeyObject keys and JWK export
  const rsa = () =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
  const apple = rsa()
  // Apple's keys endpoint serves bare n/e JWKs, no x5c
  mock.onGet('https://appleid.apple.com/auth/keys').reply(200, {
    keys: [
      {
        ...(createPublicKey(apple.publicKey).export({
          format: 'jwk',
        } as any) as object),
        kid: 'K1',
        use: 'sig',
        alg: 'RS256',
      },
    ],
  })
  const claims = { sub: 'apple-user', aud: 'com.todorant.app' }
  const sign = (key = apple.privateKey) =>
    jwt.sign(claims, key, { algorithm: 'RS256', keyid: 'K1' })

  it('accepts a token signed by a key from the JWKS', async () => {
    await expect(
      verifyAppleToken(sign(), 'com.todorant.app')
    ).resolves.toMatchObject(claims)
  })

  it('rejects another audience', async () => {
    await expect(verifyAppleToken(sign(), 'com.todorant.web')).rejects.toThrow(
      'aud parameter'
    )
  })

  it('rejects a token signed by another key', async () => {
    await expect(verifyAppleToken(sign(rsa().privateKey))).rejects.toThrow(
      'invalid signature'
    )
  })

  it('rejects HS256 signed with the public key', async () => {
    // A Buffer gets past jsonwebtoken's refusal to use a PEM as an HMAC secret
    const forged = jwt.sign(claims, Buffer.from(apple.publicKey), {
      algorithm: 'HS256',
      keyid: 'K1',
    })
    await expect(verifyAppleToken(forged)).rejects.toThrow('invalid algorithm')
  })
})

describe('apple-auth', () => {
  it('posts the code with an ES256 client secret', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    let body
    mock.onPost('https://appleid.apple.com/auth/token').reply((config) => {
      body = parse(config.data)
      return [200, { id_token: 'id' }]
    })
    const appleAuth = new AppleAuth(
      {
        client_id: 'com.todorant.web',
        team_id: 'TEAM123456',
        key_id: 'KEY1234567',
        redirect_uri: 'https://todorant.com/apple_login_result',
        scope: 'name email',
      },
      privateKey,
      'text'
    )

    await expect(appleAuth.accessToken('the-code')).resolves.toEqual({
      id_token: 'id',
    })
    expect(body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: 'com.todorant.web',
    })
    const secret: any = jwt.verify(body.client_secret, publicKey, {
      algorithms: ['ES256'],
      complete: true,
    })
    expect(secret.header.kid).toBe('KEY1234567')
    expect(secret.payload).toMatchObject({
      iss: 'TEAM123456',
      sub: 'com.todorant.web',
      aud: 'https://appleid.apple.com',
    })
  })
})
