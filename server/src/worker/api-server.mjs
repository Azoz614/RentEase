import { DurableObject } from 'cloudflare:workers'
import { handleAsNodeRequest } from 'cloudflare:node'
import { mongoOptions, populateProcessEnv, retentionMode, RETENTION_CRON } from './runtime.mjs'
import { configureAuthEmailTasks } from '../modules/auth/auth-email-tasks.mjs'

// The whole Express API runs inside one Durable Object. Unlike a stateless Worker,
// a Durable Object can keep its MongoDB connection pool open across requests, and
// its alarm replaces the Node server's 3-second delivery dispatch timer.
const PORT = 8080
const DISPATCH_INTERVAL_MS = 3000
const STARTUP_TIMEOUT_MS = 25_000

let listening = false
let startup
const watchedClients = new WeakSet()
const driverEvents = {}

// Counts MongoDB driver events so a stalled startup can be explained from the logs.
function watchDriver(client) {
  if (!client || watchedClients.has(client)) return
  watchedClients.add(client)
  for (const name of [
    'serverHeartbeatSucceeded',
    'serverHeartbeatFailed',
    'connectionCreated',
    'connectionReady',
    'connectionClosed',
    'connectionCheckOutStarted',
    'connectionCheckedOut',
    'connectionCheckOutFailed',
  ])
    client.on(name, () => {
      driverEvents[name] = (driverEvents[name] || 0) + 1
    })
}

function withTimeout(promise, describe) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(describe()), { name: 'StartupTimeout' })),
      STARTUP_TIMEOUT_MS,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export class ApiServer extends DurableObject {
  dispatchArmed = false

  // Loads Express lazily (the stateless entry Worker never needs it) and connects to
  // MongoDB once per instance. A failed connection is retried on the next request.
  start() {
    startup ??= (async () => {
      populateProcessEnv(this.env)
      const [{ default: app }, { connectDB }, { configureCloudflarePlatform }, { default: mongoose }] =
        await Promise.all([
          import('../app.js'),
          import('../config/db.js'),
          import('./platform.mjs'),
          import('mongoose'),
        ])
      configureCloudflarePlatform(this.env)
      configureAuthEmailTasks((task) => this.ctx.waitUntil(task))
      if (!listening) {
        app.set('trust proxy', true)
        app.listen(PORT)
        listening = true
      }
      // Never let a stalled connection hang every request: give up, answer 503 and
      // retry on the next request (the driver keeps connecting in the background).
      const started = Date.now()
      const connecting = connectDB(mongoOptions(this.env))
      watchDriver(mongoose.connection.client)
      await withTimeout(
        connecting,
        () =>
          `MongoDB startup exceeded ${STARTUP_TIMEOUT_MS / 1000}s ` +
          `(readyState ${mongoose.connection.readyState}, driver events ${JSON.stringify(driverEvents)})`,
      )
      console.log(`API started in ${Date.now() - started}ms; driver events ${JSON.stringify(driverEvents)}`)
    })().catch((error) => {
      startup = undefined
      throw error
    })
    return startup
  }

  async fetch(request) {
    try {
      await this.start()
    } catch (error) {
      // MongoDB driver messages name hosts (e.g. an Atlas IP access-list rejection)
      // but never include the credentials from MONGO_URI.
      console.error('API startup failed:', error?.name, error?.message)
      return Response.json(
        { message: 'RentEase is starting up or the database is unreachable. Try again shortly.' },
        { status: 503, headers: { 'Retry-After': '5' } },
      )
    }
    this.armDispatch().catch((error) => console.error('Dispatch alarm failed:', error?.name))
    return handleAsNodeRequest(PORT, request)
  }

  async armDispatch() {
    if (this.dispatchArmed) return
    this.dispatchArmed = true
    try {
      await this.ctx.storage.setAlarm(Date.now() + DISPATCH_INTERVAL_MS)
    } catch (error) {
      this.dispatchArmed = false
      throw error
    }
  }

  // Expands rider searches like the Node server's timer, but only keeps running
  // while some delivery is still searching; requests and the cron re-arm it.
  async alarm() {
    this.dispatchArmed = false
    await this.start()
    const [{ broadcastAvailableTasks }, { DeliveryTask }] = await Promise.all([
      import('../modules/delivery/delivery-task.service.mjs'),
      import('../modules/delivery/delivery-task.model.mjs'),
    ])
    await broadcastAvailableTasks()
    if (await DeliveryTask.exists({ status: 'available', 'search.state': 'searching' }))
      await this.armDispatch()
  }

  // Called over RPC by the Worker's scheduled() handler.
  async runScheduled(cron) {
    await this.start()
    if (cron !== RETENTION_CRON) {
      const { expireStaleBookings } = await import('../modules/rentals/cancellation.service.mjs')
      await expireStaleBookings().catch((error) =>
        console.error('Booking expiry sweep failed:', error.name),
      )
      return this.armDispatch()
    }
    const { purgeIdentityDocuments } = await import(
      '../modules/identity/identity-retention.service.mjs'
    )
    const result = await purgeIdentityDocuments({ apply: retentionMode(this.env) === 'apply' })
    console.log('Identity document retention:', JSON.stringify(result))
  }
}
