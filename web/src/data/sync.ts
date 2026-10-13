import { signal } from '../lib/state'
import { decrypt, encrypt } from '../lib/crypto'
import {
  acknowledge, applyRemote, applySingleton, cursor, encryptionKey, now, pending, ready, session, setCursor, setOffset, setOnChange,
  setPeople, todos, type Change,
} from './store'

export const API = import.meta.env.VITE_API ?? 'https://backend.todorant.com'

/**
 * v2 sync over one WebSocket: local edits are queued field changes pushed right away; the server
 * resolves conflicts per field and streams other devices' changes back live. A pull by cursor
 * catches up after being offline.
 */
export const connected = signal(false)
export const syncing = signal(false)

let ws: WebSocket | null = null
let attempts = 0
let retry: ReturnType<typeof setTimeout> | undefined
let pushTimer: ReturnType<typeof setTimeout> | undefined
let rid = 0
const sent = new Map<number, Change[]>()
const waiting = new Map<number, (ok: boolean) => void>()

export function start() {
  setOnChange(() => {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(() => send(), 30)
  })
  addEventListener('online', reconnect)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reconnect())
  connect()
}

function connect() {
  const token = session.value?.token
  if (!token || ws) return
  const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/v2/ws?token=${encodeURIComponent(token)}`)
  ws = socket
  socket.onmessage = (e) => {
    if (ws === socket) handle(JSON.parse(e.data)).catch(console.error)
  }
  socket.onclose = () => {
    if (ws !== socket) return
    ws = null
    connected.value = false
    sent.clear()
    waiting.forEach((done) => done(false))
    waiting.clear()
    syncing.value = false
    if (!session.value) return
    clearTimeout(retry)
    retry = setTimeout(connect, Math.min(30_000, 500 * 2 ** Math.min(attempts++, 6)))
  }
}

/** Connects right away (tab visible again, back online), dropping a socket that never got going */
export function reconnect() {
  clearTimeout(retry)
  attempts = 0
  if (ws && !connected.value) {
    const old = ws
    ws = null
    old.close()
  }
  connect()
}

export function disconnect() {
  clearTimeout(retry)
  const old = ws
  ws = null
  old?.close()
  connected.value = false
}

async function handle(m: any) {
  switch (m.t) {
    case 'hello':
      setOffset(m.now - Date.now())
      attempts = 0
      connected.value = true
      // Texts still encrypted although we have the password (it was entered mid-sync): fetch everything again
      if (encryptionKey.value && [...todos.values()].some((t) => t.encrypted && t.text.startsWith('U2FsdGVkX1'))) setCursor(null)
      await send(true)
      break
    case 'synced':
      acknowledge(sent.get(m.rid) ?? [])
      sent.delete(m.rid)
      await fixes(m.acks)
      await apply(m)
      ready.value = true
      waiting.get(m.rid)?.(true)
      waiting.delete(m.rid)
      syncing.value = waiting.size > 0
      if (pending().some((c) => ![...sent.values()].some((b) => b.includes(c)))) send()
      break
    case 'changes':
      await apply(m)
      break
    case 'pull':
      await send(true)
      break
    case 'error':
      sent.delete(m.rid)
      waiting.get(m.rid)?.(false)
      waiting.delete(m.rid)
      console.warn('sync error', m.message)
      break
  }
}

/** Sends the queued edits (and pulls when asked); resolves when the server answers */
async function send(pull = false): Promise<boolean> {
  const socket = ws
  if (!socket || !connected.value) return false
  const inFlight = new Set([...sent.values()].flat())
  const changes = pending().filter((c) => !inFlight.has(c))
  if (!changes.length && !pull) return true
  const id = ++rid
  sent.set(id, changes)
  const message: any = { t: 'sync', rid: id }
  if (changes.length) message.ops = await ops(changes)
  if (pull) message.since = cursor ?? 0
  const done = new Promise<boolean>((resolve) => waiting.set(id, resolve))
  syncing.value = true
  socket.send(JSON.stringify(message))
  return done
}

/** Field changes → one op per document and edit time; encrypted todo texts are encrypted on the way out */
async function ops(changes: Change[]) {
  const groups = new Map<string, { c: string; id?: string; at: number; set: Record<string, unknown> }>()
  for (const ch of changes) {
    const k = `${ch.c}|${ch.id}|${ch.at}`
    const op = groups.get(k) ?? { c: ch.c, ...(ch.id ? { id: ch.id } : {}), at: ch.at, set: {} }
    op.set[ch.field] = ch.value
    groups.set(k, op)
  }
  const key = encryptionKey.value
  for (const op of groups.values()) {
    const text = op.set.text
    if (op.c !== 'todo' || typeof text !== 'string' || !text) continue
    const encrypted = 'encrypted' in op.set ? op.set.encrypted : todos.get(op.id!)?.encrypted
    if (!encrypted) continue
    // An encrypted todo's text never leaves in plain text: without the key (encryption was switched off with the
    // edit still queued) the text change is held back rather than sent readable
    if (key) op.set.text = await encrypt(text, key)
    else if (!text.startsWith('U2FsdGVkX1')) delete op.set.text
  }
  return [...groups.values()]
}

/** Fields that lost to newer edits elsewhere come back as fixes */
async function fixes(acks?: any[]) {
  for (const a of acks ?? []) {
    if (a.e) console.warn('rejected', a.c, a.id, a.e)
    if (!a.fix) continue
    if (a.c === 'todo' || a.c === 'tag') await apply({ [`${a.c}s`]: [{ ...a.fix, id: a.id }] })
    else applySingleton(a.c, a.fix)
  }
}

/** Applies server data: documents, profile, settings, hero, delegation lists, cursor */
async function apply(m: any) {
  const key = encryptionKey.value
  const list: any[] = m.todos ?? []
  // Decrypt the whole batch in parallel, then apply it in one go (a full pull can be thousands of todos)
  if (key)
    await Promise.all(
      list.map(async (json) => {
        // Deltas carry changed fields only, so a text edit may come without the encrypted flag
        const encrypted = 'encrypted' in json ? json.encrypted : todos.get(json.id)?.encrypted
        if (encrypted && typeof json.text === 'string') json.text = (await decrypt(json.text, key)) ?? json.text
      }),
    )
  for (const json of list) applyRemote('todo', json)
  for (const json of m.tags ?? []) applyRemote('tag', json)
  if (m.user) {
    applySingleton('user', m.user)
    if (m.user.settings) applySingleton('settings', m.user.settings)
  }
  if (m.hero) applySingleton('hero', m.hero)
  if (m.delegation) setPeople({ delegates: m.delegation.delegates ?? [], delegators: m.delegation.delegators ?? [] })
  if (typeof m.cursor === 'number') setCursor(m.cursor)
}

/** Push + pull now; false when offline */
export async function sync() {
  connect()
  for (let i = 0; i < 100 && !connected.value; i++) await new Promise((r) => setTimeout(r, 100))
  return send(true)
}

export async function hardSync() {
  setCursor(null)
  return sync()
}

export { now }
