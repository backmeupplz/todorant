// Setup typegoose
import { Severity, setGlobalOptions } from '@typegoose/typegoose'
setGlobalOptions({
  options: {
    allowMixed: Severity.ALLOW,
  },
})
// Setup @/ aliases for modules
import 'module-alias/register'
// Get the rest of dependencies
import * as GracefulShutdown from 'http-graceful-shutdown'
import { app } from '@/app'
import { attachWebSocket } from '@/v2/ws'
import { bot } from '@/helpers/telegram'
import { ensureIndexes } from '@/v2/indexes'
import { runMongo } from '@/models/index'
import { socketServer } from '@/sockets/io'

// Only these are required; every integration (Telegram, Google Calendar, …) is off when unset
for (const name of ['MONGO', 'JWT']) {
  if (!process.env[name]) {
    console.error(`${name} is required (see .env.example)`)
    process.exit(1)
  }
}
// Node 15+ exits on an unhandled rejection: one bad message to any async handler would take
// everyone offline, so log it and keep serving
process.on('unhandledRejection', (error) =>
  console.error('Unhandled rejection', error)
)
// Run mongo
runMongo().then(() => {
  console.log('Mongo connected')
  ensureIndexes().then(
    () => console.log('Indexes ready'),
    (err) => console.log('Index error', err)
  )
})
// Start rest (and v2 sync over WebSocket on the same port)
const server = app.listen(1337).on('listening', () => {
  console.log('HTTP is listening on 1337')
})
attachWebSocket(server)
// Start sockets
socketServer.listen(3000).on('listening', () => {
  console.log('Sockets are listening on 3000')
})
// Start telegram bot
if (process.env.TELEGRAM_LOGIN_TOKEN) {
  bot.launch().then(() => {
    console.log('@todorant_bot launched')
  })
} else {
  console.log('Telegram bot disabled: set TELEGRAM_LOGIN_TOKEN')
}

// Shutdown gracefully
GracefulShutdown(app, {
  onShutdown: async () => {
    await bot.stop()
    return new Promise((res) => {
      socketServer.close(() => {
        res()
      })
    })
  },
})
