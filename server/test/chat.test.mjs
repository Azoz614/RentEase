import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { randomBytes } from 'node:crypto'
import { createApiRouter } from '../src/routes/api.routes.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createSession } from '../src/middleware/auth.mjs'
import { User } from '../src/modules/users/user.model.mjs'
import { Product } from '../src/modules/products/product.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { Conversation, ChatMessage } from '../src/modules/chat/chat.model.mjs'
import { hideContactDetails, HIDDEN_CONTACT } from '../src/modules/chat/chat.service.mjs'

let mongo, app, shop, otherShop, customer, outsider, admin, partner
const auth = (user) => ({ Authorization: `Bearer ${createSession(user._id)}` })
const models = [User, Product, RentalRequest, Conversation, ChatMessage]
const get = (user, path) => request(app).get(`/api${path}`).set(auth(user))
const post = (user, path, body) => request(app).post(`/api${path}`).set(auth(user)).send(body)
const listing = (owner, title = 'Camera') => Product.create({ title, category: 'Cameras', description: 'A camera.',
  dailyRate: 2500, photos: ['/uploads/products/00000000-0000-0000-0000-000000000000.jpg'], createdBy: owner._id, providerId: owner._id })
const booking = (product, owner) => RentalRequest.create({ customerId: customer._id,
  items: [{ productId: product._id, providerId: owner._id, providerRole: owner.role, title: product.title, rentalAmount: 2500 }],
  startDate: new Date(Date.now() + 72 * 3600000), endDate: new Date(Date.now() + 96 * 3600000),
  subtotal: 2500, total: 2500, deliveryMethod: 'pickup', status: 'pending' })

before(async () => {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
  process.env.SMTP_HOST = ''; process.env.ADMIN_EMAIL = ''
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri('rentease_chat'))
  await Promise.all(models.map((model) => model.init()))
  app = express(); app.use(express.json()); app.use('/api', createApiRouter()); app.use(errorHandler)
}, { timeout: 180000 })
beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})))
  const create = (username, role) => User.create({ username, role, email: `${username}@example.com`, phone: '0771234567',
    password: 'unused-test-password', ...(role === 'rental_shop' && { shopStatus: 'approved', shopName: `${username} rentals` }) })
  shop = await create('shop', 'rental_shop'); otherShop = await create('othershop', 'rental_shop')
  customer = await create('customer', 'user'); outsider = await create('outsider', 'user')
  admin = await create('admin', 'admin'); partner = await create('partner', 'delivery_partner')
})
after(async () => { await mongoose.disconnect(); await mongo?.stop() })

test('contact details are hidden, prices and dates are not', () => {
  for (const text of ['Call 0771234567', 'call +94 77 123 4567', 'mail me at person.name@gmail.com', 'wa.me/94771234567', '(077) 123-4567'])
    assert.ok(hideContactDetails(text).hidden, text)
  for (const text of ['It costs LKR 1,500,000 for 2 days', 'Pick up on 2026-11-02 at 10:30', 'Booking #12345678', 'I need it for 3 days'])
    assert.deepEqual(hideContactDetails(text), { body: text, hidden: false }, text)
  assert.equal(hideContactDetails('Call 0771234567 or a@b.co').body, `Call ${HIDDEN_CONTACT} or ${HIDDEN_CONTACT}`)
})

test('a customer and shop chat about a listing without seeing each other\'s contact details', async () => {
  const product = await listing(shop)
  const opened = await post(customer, '/chats', { productId: product._id })
  assert.equal(opened.status, 200, JSON.stringify(opened.body))
  assert.equal(opened.body.conversation.with, 'shop rentals')
  assert.equal(opened.body.conversation.subject.title, 'Camera')
  const id = opened.body.conversation._id
  const sent = await post(customer, `/chats/${id}/messages`, { body: 'Is it free? Call me on 077 123 4567 or customer@example.com' })
  assert.equal(sent.status, 201)
  assert.equal(sent.body.message.contactHidden, true)
  assert.equal(sent.body.message.body, `Is it free? Call me on ${HIDDEN_CONTACT} or ${HIDDEN_CONTACT}`)

  const inbox = await get(shop, '/chats')
  assert.equal(inbox.body.unread, 1)
  assert.equal(inbox.body.conversations[0].with, 'customer')
  const thread = await get(shop, `/chats/${id}/messages`)
  const visible = JSON.stringify([inbox.body, thread.body])
  for (const secret of ['customer@example.com', '0771234567', '077 123 4567', 'shop@example.com', String(customer._id)])
    assert.ok(!visible.includes(secret), `shop must not see ${secret}`)
  assert.equal(thread.body.messages.length, 1); assert.equal(thread.body.messages[0].mine, false)
  assert.equal((await get(shop, '/chats')).body.unread, 0, 'reading clears the unread count')

  assert.equal((await post(shop, `/chats/${id}/messages`, { body: 'Yes, it is free on those dates.' })).status, 201)
  assert.equal((await get(customer, '/chats')).body.unread, 1)
  assert.equal((await post(customer, '/chats', { productId: product._id })).body.conversation._id, id, 'one conversation per customer and shop')
})

test('only the two participants can use a conversation, and booking chats need the booking', async () => {
  const product = await listing(shop), theirs = await listing(otherShop, 'Tripod')
  const id = (await post(customer, '/chats', { productId: product._id })).body.conversation._id
  assert.equal((await get(outsider, `/chats/${id}/messages`)).status, 404)
  assert.equal((await post(otherShop, `/chats/${id}/messages`, { body: 'Hello' })).status, 404)
  for (const user of [admin, partner]) assert.equal((await get(user, '/chats')).status, 403)

  const rental = await booking(product, shop), otherRental = await booking(theirs, otherShop)
  assert.equal((await post(shop, '/chats', { productId: theirs._id })).status, 400)
  assert.equal((await post(shop, '/chats', { requestId: otherRental._id })).status, 404)
  const fromBooking = await post(shop, '/chats', { requestId: rental._id })
  assert.equal(fromBooking.status, 200); assert.equal(fromBooking.body.conversation._id, id)
  assert.equal(fromBooking.body.conversation.subject.title, 'Booking: Camera')
  assert.equal((await post(outsider, '/chats', { requestId: rental._id })).status, 404)

  const adminListing = await listing(admin, 'Projector')
  assert.equal((await post(customer, '/chats', { productId: adminListing._id })).status, 404)
})

test('customers find shops by shop name and shops find customers by username, then message them', async () => {
  const names = async (user, q) => (await get(user, `/chats/search?q=${encodeURIComponent(q)}`)).body.results.map((row) => row.name)
  assert.deepEqual(await names(customer, 'RENTALS'), ['othershop rentals', 'shop rentals'])
  assert.deepEqual(await names(customer, 'other'), ['othershop rentals'])
  assert.deepEqual(await names(customer, 'cust'), [], 'customers only find rental shops')
  assert.deepEqual(await names(shop, 'cust'), ['customer'])
  assert.deepEqual(await names(shop, 'shop'), [], 'shops only find customers')
  assert.deepEqual(await names(shop, 'c'), [], 'at least two characters')
  assert.deepEqual(await names(shop, '.*'), [], 'search text is not a pattern')
  for (const user of [admin, partner]) assert.equal((await get(user, '/chats/search?q=shop')).status, 403)
  const found = (await get(shop, '/chats/search?q=customer')).body.results[0]
  assert.deepEqual(Object.keys(found).sort(), ['id', 'kind', 'name'], 'no contact details in results')

  const opened = await post(shop, '/chats', { contactId: found.id })
  assert.equal(opened.status, 200, JSON.stringify(opened.body))
  assert.equal(opened.body.conversation.with, 'customer'); assert.equal(opened.body.conversation.subject, null)
  assert.equal((await post(shop, `/chats/${opened.body.conversation._id}/messages`, { body: 'Hello from the shop' })).status, 201)
  assert.equal((await get(customer, '/chats')).body.conversations[0].with, 'shop rentals')

  const shopFound = (await get(customer, '/chats/search?q=othershop')).body.results[0]
  assert.equal((await post(customer, '/chats', { contactId: shopFound.id })).status, 200)
  assert.equal((await post(customer, '/chats', { contactId: outsider._id })).status, 404, 'customers cannot message customers')
  assert.equal((await post(shop, '/chats', { contactId: otherShop._id })).status, 404, 'shops cannot message shops')
  await User.updateOne({ _id: outsider._id }, { active: false })
  assert.deepEqual(await names(shop, 'outsider'), [], 'accounts on hold are not listed')
})

test('messages are validated and rate limited', async () => {
  const id = (await post(customer, '/chats', { productId: (await listing(shop))._id })).body.conversation._id
  assert.equal((await post(customer, `/chats/${id}/messages`, { body: '   ' })).status, 400)
  assert.equal((await post(customer, `/chats/${id}/messages`, { body: 'x'.repeat(1001) })).status, 400)
  for (let n = 0; n < 20; n++) assert.equal((await post(customer, `/chats/${id}/messages`, { body: `Message ${n}` })).status, 201)
  assert.equal((await post(customer, `/chats/${id}/messages`, { body: 'One more' })).status, 429)
  await User.updateOne({ _id: shop._id }, { active: false })
  assert.equal((await post(customer, `/chats/${id}/messages`, { body: 'Hello?' })).status, 409)
})
