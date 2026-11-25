import * as SocketIO from 'socket.io'
import { apiVersion } from '@/sockets/apiVersion'
import { getUserFromToken } from '@/middlewares/authenticate'
import { isApiToken } from '@/models/apiToken'
import { report } from '@/helpers/report'

export function setupAuthorization(socket: SocketIO.Socket) {
  socket.on('authorize', async (token: string, version: string) => {
    try {
      if (!token) {
        throw new Error('No token provided')
      }
      // socket.io resolves the token only here, so a revoked API token would keep its connection:
      // API tokens sync over REST and /v2/ws, which close on revoke
      if (isApiToken(token)) return logout(socket)
      if (!version || +version < apiVersion) {
        throw new Error('Old API version, please, update the app')
      }
      const user = await getUserFromToken(token)
      if (!user) {
        throw new Error('Unauthorized')
      }
      socket.join(user._id)
      socket.emit('authorized')
      socket.authorized = true
      socket.user = user
    } catch (err) {
      logout(socket)
      await report(err)
    }
  })

  socket.on('logout', async () => {
    logout(socket)
  })
}

function logout(socket: SocketIO.Socket) {
  socket.leaveAll()
  socket.authorized = false
  socket.user = undefined
}
