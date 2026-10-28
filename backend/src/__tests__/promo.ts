import {
  Config,
  arm,
  decide,
  html,
  keyboard,
  markdown,
  memoryStore,
  promos,
  startPayload,
  unitOf,
} from '@/helpers/telegram/promo'

// The shared reply-promo hook (a copy of prime-radiant go/promo.ts and its test)
const BOT = 'todorant'
const cfg = (
  over: Partial<Config['campaigns'][0]> = {},
  enabled = true
): Config => ({
  base: 'https://lumen.borodutch.com/go',
  bots: { [BOT]: { enabled, code: 'todo' } },
  campaigns: [
    {
      id: 'p1',
      bot: BOT,
      status: 'running',
      target: 'https://t.me/voicybot',
      chats: ['private'],
      cap_days: 7,
      langs: ['en', 'ru'],
      text: { en: 'Voice to text', ru: 'Голос в текст' },
      variants: [
        { id: 'a', share: 0.1, format: 'caption' },
        {
          id: 'b',
          share: 0.1,
          format: 'button',
          text: { en: 'Btn', ru: 'Кн' },
        },
      ],
      ...over,
    },
  ],
})
const users = Array.from({ length: 20_000 }, (_, i) => 1000 + i)
const inArm = (id: string | undefined) =>
  users.find((u) => arm(cfg().campaigns[0], u)?.id === id) as number

describe('promo', () => {
  it('fixes arms per user and keeps a holdout', () => {
    const n: Record<string, number> = { a: 0, b: 0, holdout: 0 }
    for (const u of users) n[arm(cfg().campaigns[0], u)?.id ?? 'holdout']++
    expect(n.a / users.length).toBeCloseTo(0.1, 1)
    expect(n.holdout / users.length).toBeCloseTo(0.8, 1)
  })

  it('decides links, languages, chats, caps and switches', () => {
    const a = decide(cfg(), BOT, 's', inArm('a'), 'private', 'en-GB', undefined)
    expect(a?.promo).toEqual({
      text: 'Voice to text',
      url: 'https://t.me/voicybot?start=p1-a-todo',
      format: 'caption',
    })
    expect(
      decide(cfg(), BOT, 's', inArm('b'), 'private', 'ru', undefined)?.promo
        ?.text
    ).toBe('Кн')
    const web = decide(
      cfg({ target: 'https://todorant.com' }),
      BOT,
      's',
      inArm('a'),
      'private',
      'en',
      undefined
    )
    expect(web?.promo?.url).toBe(
      `https://lumen.borodutch.com/go/p1/a?u=${web?.unit}`
    )
    expect(
      decide(cfg(), BOT, 's', inArm(undefined), 'private', 'en', undefined)
    ).toMatchObject({ arm: 'holdout' })
    expect(
      decide(cfg(), BOT, 's', inArm('a'), 'group', 'en', undefined)
    ).toBeNull()
    expect(
      decide(cfg(), BOT, 's', inArm('a'), 'private', 'de', undefined)
    ).toBeNull()
    expect(
      decide(cfg({}, false), BOT, 's', inArm('a'), 'private', 'en', undefined)
    ).toBeNull()
    expect(
      decide(
        cfg({ status: 'paused' }),
        BOT,
        's',
        inArm('a'),
        'private',
        'en',
        undefined
      )
    ).toBeNull()
    expect(
      decide(cfg(), BOT, '', inArm('a'), 'private', 'en', undefined)
    ).toBeNull()
    const now = Date.now()
    expect(
      decide(
        cfg(),
        BOT,
        's',
        inArm('a'),
        'private',
        'en',
        now - 6 * 86400_000,
        now
      )?.promo
    ).toBeUndefined()
    expect(
      decide(
        cfg(),
        BOT,
        's',
        inArm('a'),
        'private',
        'en',
        now - 8 * 86400_000,
        now
      )?.promo
    ).toBeDefined()
  })

  it('renders lines and buttons', () => {
    const p = {
      text: 'A & <b>',
      url: 'https://t.me/x?start=a"b',
      format: 'caption' as const,
    }
    expect(html(p)).toBe(
      '\n\n<a href="https://t.me/x?start=a&quot;b">A &amp; &lt;b&gt;</a>'
    )
    expect(markdown({ ...p, text: 'Hi [x]_' })).toBe(
      '\n\n[Hi x](https://t.me/x?start=a"b)'
    )
    expect(
      keyboard(
        { ...p, format: 'button' },
        { inline_keyboard: [[{ text: 'x' }]] }
      )?.inline_keyboard
    ).toHaveLength(2)
    expect(keyboard(p, undefined)).toBeUndefined()
    expect(startPayload('/start@todorant_bot  xp1-b-vdb ')).toBe('xp1-b-vdb')
  })

  it('gets the salt, keeps the cap in the store and batches events', async () => {
    const sent: { url: string; body?: string }[] = []
    const g = globalThis as unknown as { fetch: unknown }
    const real = g.fetch
    const reply = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
    })
    g.fetch = async (url: string, init?: { body?: string }) => {
      sent.push({ url, body: init?.body })
      if (url.includes('/salt?bot=todorant')) return reply({ salt: 'S' })
      if (url.endsWith('campaigns.json')) return reply(cfg())
      return reply({ stored: 1 })
    }
    try {
      const h = promos(BOT, memoryStore(), { PROMO_TOKEN: 't' })
      expect(await h.decide(inArm('a'), 'private', 'en')).toBeNull()
      await h.refresh()
      const d = await h.decide(inArm('a'), 'private', 'en')
      expect(d?.unit).toBe(unitOf('S', 'p1', inArm('a')))
      await h.record(d)
      expect(
        (await h.decide(inArm('a'), 'private', 'en'))?.promo
      ).toBeUndefined()
      const ho = await h.decide(inArm(undefined), 'private', 'en')
      await h.record(ho)
      await h.record(ho)
      h.blocked(inArm(undefined))
      await h.arrived(77, 'xp1-a-vdb', true)
      await h.used(77)
      await h.used(77)
      await h.arrived(78, 'login', true)
      await h.flush()
      const events = JSON.parse(sent[sent.length - 1].body || '{}').events as {
        v: string
        k: string
      }[]
      expect(events.map((e) => `${e.v}:${e.k}`)).toEqual([
        'a:seen',
        'a:shown',
        'holdout:seen',
        'holdout:blocked',
        'a:start',
        'a:new',
        'a:use',
      ])
      expect(
        await promos(BOT, memoryStore(), {}).decide(1, 'private', 'en')
      ).toBeNull()
    } finally {
      g.fetch = real
    }
  })
})
