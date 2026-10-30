// End-to-end check of the API on the real Workers runtime: `wrangler dev` (workerd)
// against a throwaway MongoDB replica set. Covers Express inside the Durable Object,
// Mongoose over Workers TCP sockets, R2 photo storage and serving, and change-stream
// server-sent events. Run with `npm run test:worker` (also runs in CI).
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { User } from '../src/modules/users/user.model.mjs'
import { AuditLog } from '../src/modules/admin/audit-log.model.mjs'
import { DeliveryTask } from '../src/modules/delivery/delivery-task.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { startSmokeSmtp } from './smokeSmtp.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const wrangler = path.join(
  path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin',
  'wrangler.js',
)
const port = Number(process.env.SMOKE_PORT || 8799)
const base = `http://127.0.0.1:${port}`
const admin = { email: 'smoke-admin@rentease.test', password: 'smoke-password-123' }
// The password the reset check sets; later admin changes confirm with it.
const resetAdminPassword = 'New-smoke-admin-passphrase'
// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let mongo, devServer, persistDirectory, smtp
const logs = []

function startWrangler(uri) {
  const vars = {
    MONGO_URI: uri,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    OTP_SECRET: randomBytes(32).toString('hex'),
    RENTAL_OTP_SECRET: randomBytes(32).toString('hex'),
    IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    IDENTITY_HASH_KEY: randomBytes(32).toString('base64'),
    // Isolate email completely from any developer or production SMTP settings.
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port),
    SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: 'RentEase <no-reply@rentease.test>',
    GOOGLE_CLIENT_ID: '',
  }
  const args = [wrangler, 'dev', '--ip', '127.0.0.1', '--port', String(port)]
  args.push('--persist-to', persistDirectory, '--show-interactive-dev-session=false')
  for (const [key, value] of Object.entries(vars)) args.push('--var', `${key}:${value}`)
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => logs.push(chunk.toString()))
  return child
}

function stopWrangler() {
  if (!devServer || devServer.exitCode !== null) return
  // wrangler starts workerd as a child process; end the whole tree.
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(devServer.pid), '/t', '/f'], { stdio: 'ignore' })
  else devServer.kill('SIGTERM')
}

async function waitForHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let last = 'no response'
  while (Date.now() < deadline) {
    if (devServer.exitCode !== null) throw new Error(`wrangler dev exited (${devServer.exitCode}).`)
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return response.json()
      last = `HTTP ${response.status}: ${await response.text()}`
    } catch (error) {
      last = error.cause?.code || error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The Worker did not become healthy: ${last}`)
}

const call = async (pathname, { token, json, headers = {}, ...options } = {}) => {
  const response = await fetch(base + pathname, {
    ...options,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(json && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(json && { body: JSON.stringify(json), method: options.method || 'POST' }),
  })
  return response
}

const checks = []
const check = (name, run) => checks.push([name, run])

check('health reports a connected database on both paths', async () => {
  for (const pathname of ['/health', '/api/health']) {
    const response = await call(pathname)
    assert.equal(response.status, 200, pathname)
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' })
  }
})

check('public catalog reads from MongoDB through the Durable Object', async () => {
  const response = await call('/api/public/products')
  assert.equal(response.status, 200)
  assert.ok(Array.isArray((await response.json()).products))
})

let token
check('authentication rejects bad credentials and issues a session token', async () => {
  assert.equal((await call('/api/auth/me')).status, 401)
  const wrong = await call('/api/auth/login', { json: { ...admin, password: 'wrong-password-1' } })
  assert.equal(wrong.status, 401)
  const login = await call('/api/auth/login', { json: admin })
  assert.equal(login.status, 200)
  token = (await login.json()).token
  assert.ok(token)
  const me = await call('/api/auth/me', { token })
  assert.equal(me.status, 200)
})

let photo
check('registration sends SMTP email on Workers, requires proof and does not create a session', async () => {
  const details = { username: 'Smoke Customer', email: 'smoke-customer@rentease.test', phone: '0700000001' }
  const sent = await call('/api/auth/register/send-otp', { json: details })
  assert.equal(sent.status, 200, await sent.clone().text())
  assert.equal((await sent.json()).otp, undefined)
  const mail = await smtp.next(details.email)
  const verified = await call('/api/auth/register/verify-otp', { json: { email: details.email, otp: mail.otp } })
  assert.equal(verified.status, 200, await verified.clone().text())
  const { registrationToken } = await verified.json()
  const completed = await call('/api/auth/register/complete', { json: { email: details.email, password: 'Smoke-customer-passphrase', confirmPassword: 'Smoke-customer-passphrase', registrationToken } })
  assert.equal(completed.status, 201, await completed.clone().text())
  assert.equal((await completed.json()).token, undefined)
})

check('password reset delivers SMTP from a background Worker task and invalidates old sessions', async () => {
  const oldToken = token, before = smtp.count
  const sent = await call('/api/auth/forgot-password', { json: { email: admin.email } })
  assert.equal(sent.status, 200, await sent.clone().text())
  const mail = await smtp.next(admin.email, before)
  const verified = await call('/api/auth/forgot-password/verify-otp', { json: { email: admin.email, otp: mail.otp } })
  assert.equal(verified.status, 200, await verified.clone().text())
  const { resetToken } = await verified.json(), password = resetAdminPassword
  const reset = await call('/api/auth/reset-password', { json: { email: admin.email, resetToken, password, confirmPassword: password } })
  assert.equal(reset.status, 200, await reset.clone().text())
  assert.equal((await call('/api/auth/me', { token: oldToken })).status, 401)
  assert.equal((await call('/api/auth/login', { json: admin })).status, 401)
  const login = await call('/api/auth/login', { json: { email: admin.email, password } })
  assert.equal(login.status, 200, await login.clone().text())
  token = (await login.json()).token
  assert.equal((await call('/api/auth/reset-password', { json: { email: admin.email, resetToken, password: 'Another-smoke-passphrase' } })).status, 400)
})

check('product photos are stored in R2 and served by the Worker with caching headers', async () => {
  const created = await call('/api/admin/products', {
    token,
    headers: { 'CF-Connecting-IP': '203.0.113.9', 'X-Admin-Password': encodeURIComponent(resetAdminPassword) },
    json: {
      title: 'Smoke test camera',
      category: 'Cameras',
      description: 'Created by the Workers smoke test.',
      dailyRate: 1500,
      photos: Array(3).fill(`data:image/png;base64,${png.toString('base64')}`),
    },
  })
  assert.equal(created.status, 201, await created.clone().text())
  const product = (await created.json()).product
  assert.equal(product.photos.length, 3)
  photo = product.photos[0]
  assert.match(photo, /^\/uploads\/products\/[a-f0-9-]{36}\.png$/)

  const served = await call(photo)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png)
  const revalidated = await call(photo, { headers: { 'If-None-Match': served.headers.get('etag') } })
  assert.equal(revalidated.status, 304)
  assert.equal((await call('/uploads/products/0f8fad5b-d9cb-469f-a165-70867728950e.png')).status, 404)
  const edited = await call(`/api/admin/products/${product._id}`, {
    method: 'PATCH', token, headers: { 'X-Admin-Password': encodeURIComponent(resetAdminPassword) },
    json: { photos: [product.photos[2], product.photos[0]] },
  })
  assert.equal(edited.status, 200, await edited.clone().text())
  assert.deepEqual((await edited.json()).product.photos, [product.photos[2], product.photos[0]])
  assert.equal((await call(product.photos[1])).status, 404)
  assert.equal((await call(product.photos[2])).status, 200)
  const reviews = await call(`/api/public/reviews/product/${product._id}?sort=highest&page=1`)
  assert.equal(reviews.status, 200)
  const reviewPage = await reviews.json()
  assert.equal(reviewPage.summary.ratingCount, 0)
  assert.deepEqual(reviewPage.summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  assert.equal(reviewPage.pagination.pageSize, 10)
})

check('audit logs record the client address forwarded by the Worker', async () => {
  // recordAudit() is fire-and-forget, so allow it a moment to land.
  let entry
  for (let attempt = 0; attempt < 20 && !entry; attempt += 1) {
    entry = await AuditLog.findOne({ action: 'product.created' }).lean()
    if (!entry) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.equal(entry?.ipAddress, '203.0.113.9')
})

check('delivery events stream over SSE from shared change streams', async () => {
  const controller = new AbortController()
  const response = await call('/api/delivery/events', { token, signal: controller.signal })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const reader = response.body.getReader()
  const { value } = await reader.read()
  assert.match(new TextDecoder().decode(value), /delivery\.changed/)
  controller.abort()
})

check('unknown API routes return JSON 404s', async () => {
  const response = await call('/api/does-not-exist', { token })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).message, 'API endpoint not found.')
})

check('new shop payments allocate 5% once and financial reports stay scoped on Workers', async () => {
  const shop = await User.create({ username: 'smoke-finance-shop', email: 'smoke-finance-shop@rentease.test', phone: '0700000002',
    password: await bcrypt.hash('Smoke-shop-passphrase', 10), role: 'rental_shop', shopStatus: 'approved' })
  const customer = await User.findOne({ email: 'smoke-customer@rentease.test' })
  const login = await call('/api/auth/login', { json: { email: customer.email, password: 'Smoke-customer-passphrase' } })
  assert.equal(login.status, 200)
  const customerToken = (await login.json()).token
  const rental = await RentalRequest.create({ customerId: customer._id, items: [{ productId: new mongoose.Types.ObjectId(),
    providerId: shop._id, providerRole: 'rental_shop', title: 'Smoke finance camera', rentalAmount: 10000, decision: 'accepted' }],
    startDate: new Date(Date.now() + 72 * 3600000), endDate: new Date(Date.now() + 96 * 3600000),
    deliveryMethod: 'pickup', subtotal: 10000, total: 10000, status: 'confirmed' })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const paid = await call(`/api/requests/${rental._id}/payments`, { token: customerToken,
      headers: { 'Idempotency-Key': 'worker-commission-payment-123' }, json: {} })
    assert.equal(paid.status, 200, await paid.clone().text())
  }
  const report = await call('/api/commissions', { token })
  assert.equal(report.status, 200)
  const result = await report.json()
  assert.equal(result.rental.commissionMinor, 50000)
  assert.equal(result.total, 1); assert.equal(result.ledgerOnly, true)
  assert.equal((await call('/api/commissions', { token: customerToken })).status, 403)
})

check('notification read state and total unread count persist on Workers', async () => {
  const me = await (await call('/api/auth/me', { token })).json()
  const userId = me.user._id
  const { insertedId } = await mongoose.connection.db.collection('notifications').insertOne({
    userId: new mongoose.Types.ObjectId(userId), title: 'Smoke notification', body: 'Persistent inbox state',
    type: 'rental', link: 'requests', readAt: null, createdAt: new Date(), updatedAt: new Date(),
  })
  const before = await (await call('/api/inbox?limit=1', { token })).json()
  assert.equal(before.unreadCount, 1)
  const read = await call(`/api/notifications/${insertedId}`, { token, json: { read: true }, method: 'PATCH' })
  assert.equal(read.status, 200, await read.clone().text())
  const after = await (await call('/api/inbox?filter=read', { token })).json()
  assert.equal(after.unreadCount, 0); assert.equal(after.notifications[0]._id, String(insertedId))
})

check('the delivery dispatch alarm runs and the Worker logged no errors', async () => {
  // Only a dispatch pass upgrades a legacy return task to an active rider search,
  // and none of the requests above run one, so this proves the alarm fired.
  const { insertedId } = await DeliveryTask.collection.insertOne({
    direction: 'return',
    status: 'available',
  })
  assert.equal((await call('/api/health')).status, 200) // arms the 3-second alarm
  let task
  for (let attempt = 0; attempt < 40 && task?.search?.state !== 'searching'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    task = await DeliveryTask.collection.findOne({ _id: insertedId })
  }
  assert.equal(task?.search?.state, 'searching')
  const errors = logs
    .join('')
    .split('\n')
    .filter((line) => /\bERROR\b|Uncaught|alarm.*(fail|threw)/i.test(line))
  assert.deepEqual(errors, [])
})

let failed = 0
try {
  persistDirectory = await mkdtemp(path.join(tmpdir(), 'rentease-worker-smoke-'))
  smtp = await startSmokeSmtp()
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const uri = mongo.getUri('rentease-smoke')
  await mongoose.connect(uri)
  await User.create({
    username: 'smoke-admin',
    email: admin.email,
    phone: '0700000000',
    password: await bcrypt.hash(admin.password, 10),
    role: 'admin',
  })
  devServer = startWrangler(uri)
  await waitForHealth()
  for (const [name, run] of checks) {
    try {
      await run()
      console.log(`✔ ${name}`)
    } catch (error) {
      failed += 1
      console.error(`✖ ${name}\n  ${error.stack || error}`)
    }
  }
} catch (error) {
  failed += 1
  console.error(`✖ Worker smoke test could not start: ${error.stack || error}`)
} finally {
  stopWrangler()
  await smtp?.close().catch(() => {})
  if (failed) console.error(`\n--- wrangler dev output ---\n${logs.join('').slice(-6000)}`)
  await mongoose.disconnect().catch(() => {})
  await mongo?.stop().catch(() => {})
  if (persistDirectory) await rm(persistDirectory, { recursive: true, force: true }).catch(() => {})
}
console.log(failed ? `\n${failed} Worker smoke check(s) failed.` : `\nAll ${checks.length} Worker smoke checks passed.`)
process.exit(failed ? 1 : 0)
