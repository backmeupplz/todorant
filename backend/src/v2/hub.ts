import * as WebSocket from 'ws'

/** Live v2 connections by user id, for pushing changes the moment they're written */
const sockets = new Map<string, Set<WebSocket>>()

export function register(userId: string, socket: WebSocket) {
  let set = sockets.get(userId)
  if (!set) sockets.set(userId, (set = new Set()))
  set.add(socket)
  socket.on('close', () => {
    set.delete(socket)
    if (!set.size) sockets.delete(userId)
  })
}

export function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

/** Sends to every device of [userId] except [except] (the device that made the change) */
export function publish(userId: unknown, message: unknown, except?: WebSocket) {
  const set = userId && sockets.get(String(userId))
  if (!set) return
  const data = JSON.stringify(message)
  for (const socket of set) {
    if (socket !== except && socket.readyState === WebSocket.OPEN)
      socket.send(data)
  }
}

/** Something changed in a way we can't describe cheaply (v1 bulk writes): devices pull a delta */
export const hint = (userId: unknown) => publish(userId, { t: 'pull' })

export const socketsOf = (userId: string) => sockets.get(userId)?.size || 0

/** Closes every socket of a deleted account (reconnects are refused: its token no longer resolves) */
export const kick = (userId: unknown) =>
  sockets.get(String(userId))?.forEach((s) => s.close(4401, 'Unauthorized'))

/** Live sockets by the hash of the API token they connected with, to close them when it's revoked */
const tokenSockets = new Map<string, Set<WebSocket>>()

export function registerToken(hash: string, socket: WebSocket) {
  let set = tokenSockets.get(hash)
  if (!set) tokenSockets.set(hash, (set = new Set()))
  set.add(socket)
  socket.on('close', () => {
    set.delete(socket)
    if (!set.size) tokenSockets.delete(hash)
  })
}

/** Closes the sockets opened with a revoked API token */
export const kickToken = (hash: string) =>
  tokenSockets.get(hash)?.forEach((s) => s.close(4401, 'Unauthorized'))
