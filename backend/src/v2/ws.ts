import * as WebSocket from 'ws'
import { Server } from 'http'
import { authenticate, tokenOf } from '@/v2/auth'
import { pull, push } from '@/v2/sync'
import { register, send } from '@/v2/hub'

type Message = { t: string; rid?: unknown; since?: number; ops?: []; key?: string }

/**
 * One message type does everything: `{t: 'sync', rid, ops?, since?}` pushes ops (if any) and/or pulls
 * the delta since a cursor, answered by `{t: 'synced', rid, acks?, cursor, todos, …}`. The server also
 * sends `{t: 'changes', …}` the moment another device writes, and `{t: 'pull'}` when a pull is needed.
 */
export function attachWebSocket(server: Server) {
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: { threshold: 512 }, maxPayload: 16 * 1024 * 1024 })
  server.on('upgrade', async (request, socket, head) => {
    if (!request.url?.startsWith('/v2/ws')) return
    const userId = await authenticate(tokenOf(request.headers, request.url))
    if (!userId) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return
    }
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
      ws.on('message', async (data) => {
        let message: Message
        try {
          message = JSON.parse(String(data))
        } catch {
          return send(ws, { t: 'error', message: 'Invalid JSON' })
        }
        if (message.t !== 'sync') return
        try {
          const acks = message.ops?.length ? await push(userId, message.ops, ws, message.key) : undefined
          const delta = message.since !== undefined ? await pull(userId, message.since || undefined) : {}
          send(ws, { t: 'synced', rid: message.rid, acks, ...delta })
        } catch (error) {
          send(ws, { t: 'error', rid: message.rid, message: (error as Error).message })
        }
      })
      // The server clock lets clients timestamp edits on the server's timeline
      send(ws, { t: 'hello', now: Date.now(), user: userId })
    })
  })
}
