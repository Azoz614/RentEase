import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createAuthRouter } from '../src/modules/auth/auth.routes.js'
import { PendingRegistration } from '../src/modules/auth/pending-registration.model.mjs'
import { PasswordReset } from '../src/modules/auth/password-reset.model.mjs'
import { VerificationRate } from '../src/modules/otp/verification-rate.model.mjs'
import { User } from '../src/modules/users/user.model.mjs'
import { requireUser } from '../src/middleware/auth.mjs'
import { authHash } from '../src/modules/auth/auth-security.service.mjs'

let mongo, app, passwordHash, user, emails = [], tasks = [], failMail = false, mailGate
const password = 'Original-passphrase-2026'
const newPassword = 'Replacement-passphrase-2026'
const details = { username: 'New Customer', email: 'new@example.test', phone: '0771234567' }
const post = (path, data, prefix = '/api') => request(app).post(`${prefix}/auth/${path}`).send(data)
async function flushMail() { await Promise.all(tasks.splice(0)) }
async function sendReset(email = user.email) {
  const result = await post('forgot-password', { email })
  await flushMail()
  return result
}
async function resetProof() {
  assert.equal((await sendReset()).status, 200)
  const result = await post('forgot-password/verify-otp', { email: user.email, otp: emails.at(-1).otp })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  return result.body.resetToken
}
async function registerProof(extra = {}) {
  const input = { ...details, ...extra }
  assert.equal((await post('register/send-otp', input)).status, 200)
  const result = await post('register/verify-otp', { email: input.email, otp: emails.at(-1).otp })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  return result.body.registrationToken
}
async function releaseCooldown(email) {
  await VerificationRate.updateMany({ _id: email ? `auth:cooldown:${authHash('password-reset-send', email)}` : /^auth:cooldown:/ }, { $set: { expiresAt: new Date(0) } })
}

before(async () => {
  process.env.OTP_SECRET = randomBytes(32).toString('hex')
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
  process.env.ADMIN_EMAIL = ''
  process.env.NODE_ENV = 'test'
  passwordHash = await bcrypt.hash(password, 10)
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('rentease_authentication_tests'))
  await Promise.all([User.init(), PendingRegistration.init(), PasswordReset.init(), VerificationRate.init()])
  app = express(); app.use(express.json())
  const router = createAuthRouter({
    sendEmail: async (email, otp, message) => {
      if (mailGate) await mailGate
      if (failMail) throw new Error('SMTP unavailable: private diagnostic')
      emails.push({ email, otp, message })
    },
    defer: (work) => { tasks.push(Promise.resolve().then(work)) },
  })
  app.use('/api/v1/auth', router); app.use('/api/auth', router)
  app.get('/me', requireUser, (_req, res) => res.json({ authenticated: true }))
}, { timeout: 180000 })
beforeEach(async () => {
  await flushMail(); emails = []; failMail = false; mailGate = null
  await Promise.all([User.deleteMany({}), PendingRegistration.deleteMany({}), PasswordReset.deleteMany({}), VerificationRate.deleteMany({})])
  user = await User.create({ username: 'Existing Customer', email: 'existing@example.test', phone: '0771234568', password: passwordHash })
})
after(async () => { await flushMail(); await mongoose.disconnect(); await mongo?.stop() })

test('reset goes from real generated email code to one-use proof and a new hashed password', async () => {
  const oldLogin = await post('login', { email: user.email, password })
  assert.equal(oldLogin.status, 200)
  const resetToken = await resetProof()
  assert.match(emails.at(-1).otp, /^\d{6}$/)
  assert.match(emails.at(-1).message.subject, /Reset/)
  const record = await PasswordReset.findOne().select('+resetTokenHash +otpHash').lean()
  assert.equal(record.otpHash, undefined)
  assert.notEqual(record.resetTokenHash, resetToken)
  const result = await post('reset-password', { email: user.email, resetToken, password: newPassword, confirmPassword: newPassword })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const saved = await User.findById(user._id)
  assert.notEqual(saved.password, newPassword)
  assert.ok(await bcrypt.compare(newPassword, saved.password))
  assert.equal(await User.countDocuments(), 1)
  assert.equal(await PasswordReset.countDocuments(), 0)
  assert.equal((await post('login', { email: user.email, password })).status, 401)
  const freshLogin = await post('login', { email: user.email, password: newPassword })
  assert.equal(freshLogin.status, 200)
  assert.equal((await request(app).get('/me').set('Authorization', `Bearer ${oldLogin.body.token}`)).status, 401)
  assert.equal((await request(app).get('/me').set('Authorization', `Bearer ${freshLogin.body.token}`)).status, 200)
  assert.equal((await post('reset-password', { email: user.email, resetToken, password: 'Another-new-password' })).status, 400)
})

test('reset requests give identical responses and limits for known, unknown and suspended accounts', async () => {
  const known = await sendReset()
  const unknown = await sendReset('unknown@example.test')
  await User.updateOne({ _id: user._id }, { $set: { active: false } })
  await releaseCooldown(user.email)
  const suspended = await sendReset()
  for (const result of [known, unknown, suspended]) {
    assert.equal(result.status, 200)
    assert.equal(result.body.message, known.body.message)
    assert.deepEqual(Object.keys(result.body), ['message', 'serverTime', 'expiresAt', 'resendAt'])
    assert.equal(result.headers['cache-control'], 'no-store')
  }
  assert.equal(emails.length, 1)
  for (const email of [user.email, 'unknown@example.test']) {
    const blocked = await post('forgot-password', { email })
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers['retry-after']) > 0)
  }
})

test('slow email does not delay the public reset response or reveal account existence', async () => {
  let release
  mailGate = new Promise((resolve) => { release = resolve })
  try {
    const result = await post('forgot-password', { email: user.email }).timeout(1500)
    assert.equal(result.status, 200)
    assert.equal(emails.length, 0)
  } finally { release(); await flushMail() }
  assert.equal(emails.length, 1)
})

test('SMTP failure invalidates the reset challenge without leaking private diagnostics', async () => {
  failMail = true
  const result = await sendReset()
  assert.equal(result.status, 200)
  assert.equal(await PasswordReset.countDocuments(), 0)
  assert.equal(JSON.stringify(result.body).includes('SMTP'), false)
  assert.equal((await post('forgot-password/verify-otp', { email: user.email, otp: '123456' })).status, 400)
})

test('reset rejects malformed emails, wrong codes, expired codes and unverified changes', async () => {
  assert.equal((await post('forgot-password', { email: 'bad-address' })).status, 400)
  assert.equal((await post('forgot-password', { email: { $ne: null } })).status, 400)
  assert.equal((await sendReset()).status, 200)
  const otp = emails.at(-1).otp
  const wrong = otp === '000000' ? '999999' : '000000'
  assert.equal((await post('forgot-password/verify-otp', { email: user.email, otp: wrong })).status, 400)
  assert.equal((await post('reset-password', { email: user.email, password: newPassword })).status, 400)
  await PasswordReset.updateOne({}, { $set: { expiresAt: new Date(0) } })
  assert.equal((await post('forgot-password/verify-otp', { email: user.email, otp })).status, 400)
  assert.ok(await bcrypt.compare(password, (await User.findById(user._id)).password))
})

test('concurrent wrong OTP submissions cannot exceed five attempts', async () => {
  await sendReset()
  const otp = emails.at(-1).otp, wrong = otp === '000000' ? '999999' : '000000'
  const results = await Promise.all(Array.from({ length: 8 }, () => post('forgot-password/verify-otp', { email: user.email, otp: wrong })))
  assert.ok(results.every((result) => result.status === 400))
  assert.equal((await PasswordReset.findOne()).attempts, 5)
  assert.equal((await post('forgot-password/verify-otp', { email: user.email, otp })).status, 400)
})

test('resend rotates the code and invalidates previously verified reset proof', async () => {
  const resetToken = await resetProof()
  const oldOtp = emails.at(-1).otp
  assert.equal((await post('forgot-password', { email: user.email })).status, 429)
  await releaseCooldown(); await sendReset()
  assert.equal((await post('reset-password', { email: user.email, resetToken, password: newPassword })).status, 400)
  assert.equal((await PasswordReset.findOne()).verifiedAt, undefined)
  if (emails.at(-1).otp !== oldOtp)
    assert.equal((await post('forgot-password/verify-otp', { email: user.email, otp: oldOtp })).status, 400)
})

test('password policy, confirmation, expiry and concurrent reset replay are enforced', async () => {
  const resetToken = await resetProof(), body = { email: user.email, resetToken, password: newPassword }
  for (const extra of [{ password: 'short' }, { password: 'é'.repeat(40) }, { confirmPassword: 'mismatch' }, { password }])
    assert.equal((await post('reset-password', { ...body, ...extra })).status, 400)
  const results = await Promise.all([post('reset-password', body), post('reset-password', body)])
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400])
  await releaseCooldown()
  const nextToken = await resetProof()
  await PasswordReset.updateOne({}, { $set: { expiresAt: new Date(0) } })
  assert.equal((await post('reset-password', { email: user.email, resetToken: nextToken, password: 'One-more-new-password' })).status, 400)
})

test('changing the password or email by another flow invalidates reset proof', async () => {
  const resetToken = await resetProof()
  await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash('Changed-elsewhere-2026', 10) } })
  assert.equal((await post('reset-password', { email: user.email, resetToken, password: newPassword })).status, 400)
})

test('legacy signed sessions remain valid until the account password is reset', async () => {
  const payload = Buffer.from(JSON.stringify({ sub: String(user._id), exp: Date.now() + 60_000 })).toString('base64url')
  const token = `${payload}.${createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url')}`
  assert.equal((await request(app).get('/me').set('Authorization', `Bearer ${token}`)).status, 200)
})

test('registration requires the email code and browser proof before creating a hashed account', async () => {
  assert.equal((await post('register/send-otp', details)).status, 200)
  assert.equal(await User.countDocuments({ email: details.email }), 0)
  assert.equal((await post('register/complete', { email: details.email, password })).status, 400)
  const result = await post('register/verify-otp', { email: details.email, otp: emails.at(-1).otp })
  assert.equal(result.status, 200)
  assert.equal(result.body.otp, undefined)
  assert.equal((await post('register/complete', { email: details.email, password })).status, 400)
  assert.equal((await post('register/complete', { email: details.email, password, registrationToken: 'a'.repeat(43) })).status, 400)
  const complete = await post('register/complete', { email: details.email, password, confirmPassword: password, registrationToken: result.body.registrationToken })
  assert.equal(complete.status, 201, JSON.stringify(complete.body))
  assert.match(complete.body.message, /Please sign in/)
  assert.equal(complete.body.token, undefined)
  assert.match(complete.headers['set-cookie'][0], /rentease_registration=;.*HttpOnly/)
  assert.equal(await PendingRegistration.countDocuments(), 0)
  const registered = await User.findOne({ email: details.email })
  assert.ok(await bcrypt.compare(password, registered.password))
  assert.equal((await post('login', { email: details.email, password })).status, 200)
})

test('registration keeps shop approval and prevents self-registering privileged roles', async () => {
  const registrationToken = await registerProof({ accountType: 'rental_shop', shopName: 'Test Shop' })
  assert.equal((await post('register/complete', { email: details.email, password, registrationToken })).status, 201)
  const shop = await User.findOne({ email: details.email })
  assert.equal(shop.role, 'rental_shop'); assert.equal(shop.shopStatus, 'pending')
  assert.equal((await post('login', { email: details.email, password })).status, 403)
  await releaseCooldown()
  const second = { ...details, email: 'second@example.test', username: 'Second Customer', accountType: 'admin' }
  const token = await registerProof(second)
  assert.equal((await post('register/complete', { email: second.email, password, registrationToken: token })).status, 201)
  assert.equal((await User.findOne({ email: second.email })).role, 'user')
})

test('legacy same-origin registration clients use an HttpOnly proof cookie without changing their request body', async () => {
  const browser = request.agent(app)
  assert.equal((await browser.post('/api/auth/register/send-otp').send(details)).status, 200)
  const verified = await browser.post('/api/auth/register/verify-otp').send({ email: details.email, otp: emails.at(-1).otp })
  assert.equal(verified.status, 200)
  assert.match(verified.headers['set-cookie'][0], /HttpOnly/)
  assert.match(verified.headers['set-cookie'][0], /SameSite=Strict/)
  const completed = await browser.post('/api/auth/register/complete').send({ email: details.email, password })
  assert.equal(completed.status, 201, JSON.stringify(completed.body))
  assert.equal(completed.body.token, undefined)
})

test('registration validates identity fields, duplicates and password confirmation', async () => {
  for (const extra of [{ email: 'bad' }, { username: ' ' }, { phone: 'no-phone' }, { accountType: 'rental_shop' }])
    assert.equal((await post('register/send-otp', { ...details, ...extra })).status, 400)
  assert.equal((await post('register/send-otp', { ...details, username: user.username })).status, 409)
  await releaseCooldown()
  const registrationToken = await registerProof()
  assert.equal((await post('register/complete', { email: details.email, password, confirmPassword: 'mismatch', registrationToken })).status, 400)
})

test('interrupted verified registration can request a fresh code without getting stuck', async () => {
  const oldToken = await registerProof()
  assert.equal((await post('register/send-otp', details)).status, 429)
  await releaseCooldown()
  const newToken = await registerProof()
  assert.notEqual(oldToken, newToken)
  assert.equal((await post('register/complete', { email: details.email, password, registrationToken: oldToken })).status, 400)
  assert.equal((await post('register/complete', { email: details.email, password, registrationToken: newToken })).status, 201)
})

test('concurrent registration completion creates exactly one account', async () => {
  const registrationToken = await registerProof()
  const body = { email: details.email, password, registrationToken }
  const results = await Promise.all([post('register/complete', body), post('register/complete', body)])
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 400])
  assert.equal(await User.countDocuments({ email: details.email }), 1)
})

test('registration codes expire, limit concurrent attempts and cannot be reused after verification', async () => {
  await post('register/send-otp', details)
  const otp = emails.at(-1).otp, wrong = otp === '000000' ? '999999' : '000000'
  const attempts = await Promise.all(Array.from({ length: 8 }, () => post('register/verify-otp', { email: details.email, otp: wrong })))
  assert.ok(attempts.every((result) => result.status === 400))
  assert.equal((await PendingRegistration.findOne()).otpAttempts, 5)
  assert.equal((await post('register/verify-otp', { email: details.email, otp })).status, 400)
  await releaseCooldown()
  await post('register/send-otp', details)
  const newOtp = emails.at(-1).otp
  await PendingRegistration.updateOne({}, { $set: { otpExpiresAt: new Date(0) } })
  assert.equal((await post('register/verify-otp', { email: details.email, otp: newOtp })).status, 400)
  await releaseCooldown()
  const token = await registerProof()
  assert.equal((await post('register/verify-otp', { email: details.email, otp: emails.at(-1).otp })).status, 400)
  await PendingRegistration.updateOne({}, { $set: { expiresAt: new Date(0) } })
  assert.equal((await post('register/complete', { email: details.email, password, registrationToken: token })).status, 400)
})

test('registration mail failures clear unusable pending state and both API prefixes work', async () => {
  failMail = true
  const result = await post('register/send-otp', details, '/api/v1')
  assert.equal(result.status, 503)
  assert.equal(JSON.stringify(result.body).includes('private diagnostic'), false)
  assert.equal(await PendingRegistration.countDocuments(), 0)
  assert.equal((await post('login', { email: user.email, password }, '/api/v1')).status, 200)
  assert.equal(authHash('registration', 'test') === authHash('password-reset-token', 'test'), false)
})
