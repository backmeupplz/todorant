import { appleAuthKey } from '@/helpers/appleAuthKey'
import { resolve } from 'path'

describe('appleAuthKey', () => {
  it('defaults to the bundled key file', () => {
    expect(appleAuthKey({})).toStrictEqual({
      keyId: 'M3N8Y594JS',
      teamId: 'ACWP4F58HZ',
      privateKey: resolve(__dirname, '../../assets/AppleAuth.p8'),
      method: 'file',
    })
  })

  it('reads a replacement key file and ids from the env', () => {
    expect(
      appleAuthKey({
        APPLE_KEY_ID: 'NEWKEY1234',
        APPLE_TEAM_ID: 'TEAM123456',
        APPLE_KEY_PATH: '/keys/AuthKey.p8',
      })
    ).toStrictEqual({
      keyId: 'NEWKEY1234',
      teamId: 'TEAM123456',
      privateKey: '/keys/AuthKey.p8',
      method: 'file',
    })
  })

  it('prefers the key itself, restoring escaped newlines', () => {
    const key = appleAuthKey({
      APPLE_KEY_ID: 'NEWKEY1234',
      APPLE_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      APPLE_KEY_PATH: '/keys/AuthKey.p8',
    })
    expect(key.method).toBe('text')
    expect(key.privateKey).toBe(
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
    )
    expect(key.keyId).toBe('NEWKEY1234')
  })
})
