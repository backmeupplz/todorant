import * as SocketIO from 'socket.io'
import { createServer } from 'http'

export const socketServer = createServer()
export const io = SocketIO(socketServer, {
  // 50 MB: bounded (was 9e10), still far above any legit v1 sync push
  maxHttpBufferSize: 5e7,
  pingTimeout: 30000,
})
