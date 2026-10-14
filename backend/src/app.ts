// Setup typegoose
import { Severity, setGlobalOptions } from '@typegoose/typegoose'
setGlobalOptions({
  options: {
    allowMixed: Severity.ALLOW,
  },
})
// Get environment variables
import * as dotenv from 'dotenv'
dotenv.config({ path: `${process.cwd()}/.env` })
// The rest of dependencies
import '@/helpers/googleCalendarChannel'
import '@/sockets'
import 'reflect-metadata'
import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as bodyParser from 'koa-bodyparser'
import * as cors from '@koa/cors'
import * as logger from 'koa-logger'
import * as mount from 'koa-mount'
import * as serve from 'koa-static'
import { bootstrapControllers } from 'koa-ts-controllers'
import { handleMongoErrors } from '@/middlewares/handleMongoErrors'
import { v2 } from '@/v2/http'

export const app = new Koa()
// ctx.ip is the client's (the per-IP sign-in and sign-up limits), not the reverse proxy's: the last
// X-Forwarded-For hop is the one the proxy added. ponytail: without a proxy a client can pick its own IP
// there, leaving the per-address limits; add a TRUST_PROXY switch if bare-port servers need it
app.proxy = true
app.maxIpsCount = 1
;(async () => {
  try {
    const router = new Router()

    await bootstrapControllers(app, {
      router,
      basePath: '/',
      controllers: [__dirname + '/controllers/*'],
      disableVersioning: true,
      flow: [logger(), handleMongoErrors],
    })

    // Run app
    app.use(cors({ origin: '*' }))
    app.use(bodyParser({ jsonLimit: '100mb' }))
    app.use(v2.routes())
    app.use(v2.allowedMethods())
    app.use(router.routes())
    app.use(router.allowedMethods())
    app.use(mount('/docs', serve('./docs/site')))
  } catch (err) {
    console.log('Koa app starting error: ', err)
  }
})()
