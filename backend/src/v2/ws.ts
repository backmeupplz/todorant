import * as WebSocket from 'ws'
import { PROTOCOL, authenticate, socketTokenOf, spend } from '@/v2/auth'
import { Server } from 'http'
import { invalid } from '@/v2/schema'
import { pull, push } from '@/v2/sync'
import { register, send, socketsOf } from '@/v2/hub'

type Message = {
  t: string
  rid?: unknown
  since?: number
  ops?: []
  key?: string
}

/** Sockets one user may hold at once (tabs, phones, widgets) */
const MAX_SOCKETS = 20
/** Bytes of messages a socket may have waiting; past that it's flooding */
const MAX_QUEUED = 32 * 1024 * 1024

/**
 * One message type does everything: `{t: 'sync', rid, ops?, since?}` pushes ops (if any) and/or pulls
 * the delta since a cursor, answered by `{t: 'synced', rid, acks?, cursor, todos, …}`. The server also
 * sends `{t: 'changes', …}` the moment another device writes, and `{t: 'pull'}` when a pull is needed.
 */
export function attachWebSocket(server: Server) {
  const wss = new WebSocket.Server({
    noServer: true,
    perMessageDeflate: { threshold: 512 },
    maxPayload: 16 * 1024 * 1024,
    // Browsers offer [PROTOCOL, token]: agree on the former, never echo the token
    handleProtocols: (protocols: string[]) =>
      protocols.includes(PROTOCOL) && PROTOCOL,
  })
  server.on('upgrade', async (request, socket, head) => {
    if (!request.url?.startsWith('/v2/ws')) return
    const userId = await authenticate(socketTokenOf(request))
    if (!userId) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    if (socketsOf(userId) >= MAX_SOCKETS || !spend(userId, 1))
      return socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n')
    wss.handleUpgrade(request, socket, head, (ws) => {
      register(userId, ws)
      let alive = true
      ws.on('pong', () => (alive = true))
      const ping = setInterval(() => {
        if (!alive) return ws.terminate()
        alive = false
        ws.ping()
      }, 30000)
      ws.on('close', () => clearInterval(ping))
      // One message at a time, in order
      let queue = Promise.resolve()
      let queued = 0
      ws.on('message', (data) => {
        const text = String(data)
        if ((queued += text.length) > MAX_QUEUED) return ws.terminate()
        queue = queue
          .then(() => handle(userId, ws, text))
          .catch(console.error)
          .then(() => void (queued -= text.length))
      })
      // The server clock lets clients timestamp edits on the server's timeline
      send(ws, { t: 'hello', now: Date.now(), user: userId })
    })
  })
}

async function handle(userId: string, ws: WebSocket, text: string) {
  let message: Message
  try {
    message = JSON.parse(text)
  } catch {
    return send(ws, { t: 'error', message: 'Invalid JSON' })
  }
  if (message?.t !== 'sync') return
  const { rid, since, ops } = message
  try {
    if (!spend(userId, 1)) throw invalid('Too many requests')
    if (since !== undefined && !Number.isFinite(since))
      throw invalid('Invalid since')
    const acks = ops?.length
      ? await push(userId, ops, ws, message.key)
      : undefined
    const delta =
      since !== undefined ? await pull(userId, since || undefined) : {}
    send(ws, { t: 'synced', rid, acks, ...delta })
  } catch (error) {
    // Only errors we raised on purpose are worth telling (and safe to show)
    const status = (error as { status?: number }).status
    if (!status) console.error(error)
    send(ws, {
      t: 'error',
      rid,
      message: status ? (error as Error).message : 'Internal Server Error',
    })
  }
}
