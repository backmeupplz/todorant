import {
  TelegramLoginPayload,
  verifyTelegramPayload,
} from '@/helpers/verifyTelegramPayload'

describe('verifyTelegramPayload', () => {
  let payload: TelegramLoginPayload
  const token = process.env.TELEGRAM_LOGIN_TOKEN

  beforeAll(() => {
    process.env.TELEGRAM_LOGIN_TOKEN = 'test'
  })

  beforeEach(() => {
    payload = {
      id: 123124125,
      hash: 'hash at string',
      auth_date: '14.07.2020',
      first_name: 'Semion',
      last_name: 'Babak',
      username: 'mrbabak',
      photo_url: 'https://user_photo_url.com',
    }
  })

  afterAll(() => {
    if (token === undefined) delete process.env.TELEGRAM_LOGIN_TOKEN
    else process.env.TELEGRAM_LOGIN_TOKEN = token
  })

  it('refuses a wrong hash', () => {
    expect(verifyTelegramPayload(payload)).toBe(false)
  })

  it('returns a payload signed with the bot token', () => {
    // HMAC-SHA256 of the sorted fields, keyed with SHA-256("test") (Telegram's login widget check)
    payload.hash =
      '856fe2cc76e4812c2abc89970f18c65ee72eafa175d3202bd43b797747abee93'
    expect(verifyTelegramPayload(payload)).toBe(payload)
  })

  it('refuses every payload without a bot token', () => {
    delete process.env.TELEGRAM_LOGIN_TOKEN
    payload.hash =
      '5e41f9240978ccea45d970077ea2e71c74db89624cd307739137ab6e33766d57' // keyed with SHA-256("")
    expect(verifyTelegramPayload(payload)).toBe(false)
    process.env.TELEGRAM_LOGIN_TOKEN = 'test'
  })
})
