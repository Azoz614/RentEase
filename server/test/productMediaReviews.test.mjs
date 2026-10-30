import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { randomBytes } from 'node:crypto'
import { createApiRouter } from '../src/routes/api.routes.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createSession } from '../src/middleware/auth.mjs'
import { User } from '../src/modules/users/user.model.mjs'
import { Product } from '../src/modules/products/product.model.mjs'
import { RentalReview } from '../src/modules/products/rental-review.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { configureProductPhotoStore, saveProductPhotos } from '../src/modules/products/product-images.service.mjs'

let mongo, app, shop, customer, outsider, admin
const objects = new Map()
const auth = (user) => ({ Authorization: `Bearer ${createSession(user._id)}` })
const png = 'data:image/png;base64,iVBORw0KGgo='
const fields = { title: 'Camera', category: 'Cameras', description: 'Three views of this camera.', dailyRate: 2500 }
const models = [User, Product, RentalReview, RentalRequest]
before(async () => {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
  process.env.SMTP_HOST = ''; process.env.ADMIN_EMAIL = ''
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri('product_media_reviews'))
  await Promise.all(models.map((model) => model.init()))
  configureProductPhotoStore({ put: async (name, bytes) => objects.set(name, bytes), get: async (name) => objects.get(name), delete: async (name) => objects.delete(name) })
  app = express(); app.use(express.json({ limit: '22mb' })); app.use('/api', createApiRouter()); app.use(errorHandler)
}, { timeout: 180000 })
beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})))
  objects.clear()
  const create = (username, role) => User.create({ username, role, email: `${username}@example.com`, phone: '0771234567', password: 'unused-test-password', ...(role === 'rental_shop' && { shopStatus: 'approved', shopName: username }) })
  shop = await create('shop', 'rental_shop'); customer = await create('customer', 'user'); outsider = await create('outsider', 'user'); admin = await create('admin', 'admin')
})
after(async () => { await mongoose.disconnect(); await mongo?.stop() })
const publish = async () => {
  const result = await request(app).post('/api/owner/products').set(auth(shop)).send({ ...fields, photos: [png, png, png] })
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.product
}

test('shop publishes multiple photos, reorders cover, replaces photos and deletes removed objects', async () => {
  const product = await publish()
  assert.equal(product.photos.length, 3); assert.equal(objects.size, 3)
  const updated = await request(app).patch(`/api/owner/products/${product._id}`).set(auth(shop)).send({ photos: [product.photos[2], product.photos[0], png] })
  assert.equal(updated.status, 200); assert.equal(updated.body.product.photos[0], product.photos[2])
  assert.equal(objects.size, 3); assert.equal(objects.has(product.photos[1].split('/').pop()), false)
  const catalog = await request(app).get('/api/public/products')
  assert.deepEqual(catalog.body.products[0].photos, updated.body.product.photos)
})

test('invalid photos and foreign stored paths preserve the existing product and do not orphan objects', async () => {
  const product = await publish()
  for (const photos of [[], Array(7).fill(png), [product.photos[0], 'data:image/png;base64,YmFk'], ['/uploads/products/00000000-0000-4000-8000-000000000000.png']]) {
    const result = await request(app).patch(`/api/owner/products/${product._id}`).set(auth(shop)).send({ photos })
    assert.equal(result.status, 400, JSON.stringify(result.body)); assert.equal(objects.size, 3)
    assert.deepEqual((await Product.findById(product._id)).photos.toObject(), product.photos)
  }
  assert.equal((await request(app).patch(`/api/owner/products/${product._id}`).set(auth(customer)).send({ photos: [png] })).status, 403)
})

test('admin can retain a cover and append another image; failed writes roll back new uploads', async () => {
  const product = await publish()
  await User.updateOne({ _id: admin._id }, { password: await bcrypt.hash('Admin-test-password', 4) })
  const result = await request(app).patch(`/api/admin/products/${product._id}`).set(auth(admin))
    .set('X-Admin-Password', 'Admin-test-password').send({ photos: [product.photos[0], png] })
  assert.equal(result.status, 200); assert.equal(objects.size, 2)
  let writes = 0
  const retained = new Set(objects.keys())
  configureProductPhotoStore({ put: async (name, bytes) => { if (++writes === 2) throw new Error('storage unavailable'); objects.set(name, bytes) }, delete: async (name) => objects.delete(name) })
  try { await assert.rejects(saveProductPhotos([png, png]), /storage unavailable/); assert.deepEqual(new Set(objects.keys()), retained) }
  finally { configureProductPhotoStore({ put: async (name, bytes) => objects.set(name, bytes), get: async (name) => objects.get(name), delete: async (name) => objects.delete(name) }) }
})

test('reviews paginate, filter, sort and summarize all customer reviews without exposing owner feedback', async () => {
  const product = await publish()
  const rows = Array.from({ length: 23 }, (_, index) => ({ requestId: new mongoose.Types.ObjectId(), productId: product._id, authorId: customer._id, targetId: shop._id, direction: 'customer_to_owner', rating: index < 12 ? 5 : 2, comment: `Review ${index}` }))
  await RentalReview.create([...rows, { ...rows[0], requestId: new mongoose.Types.ObjectId(), authorId: shop._id, targetId: customer._id, direction: 'owner_to_customer', rating: 1, comment: 'Private renter feedback' }])
  const url = `/api/public/reviews/product/${product._id}`
  const first = await request(app).get(url)
  assert.equal(first.status, 200); assert.equal(first.body.reviews.length, 10)
  assert.equal(first.body.summary.ratingCount, 23); assert.equal(first.body.summary.distribution[5], 12)
  assert.equal(first.body.summary.ratingAverage, 82 / 23)
  const second = await request(app).get(`${url}?page=2`)
  assert.equal(second.body.pagination.pages, 3)
  assert.equal(new Set([...first.body.reviews, ...second.body.reviews].map((row) => row._id)).size, 20)
  const filtered = await request(app).get(`${url}?rating=2&sort=lowest&page=2`)
  assert.equal(filtered.body.reviews.length, 1); assert.equal(filtered.body.pagination.total, 11)
  assert.equal(filtered.body.summary.ratingCount, 23)
  const highest = await request(app).get(`${url}?sort=highest`)
  assert.ok(highest.body.reviews.every((row) => row.rating === 5))
  assert.ok(first.body.reviews.every((row) => !('requestId' in row) && !('targetId' in row)))
  const signedIn = await request(app).get(`/api/reviews/product/${product._id}`).set(auth(customer))
  assert.deepEqual(signedIn.body.summary, first.body.summary)
  for (const query of ['page=0', 'page=1.5', 'rating=6', 'rating=0', 'sort=constructor', 'sort=invalid']) assert.equal((await request(app).get(`${url}?${query}`)).status, 400)
})

test('only a rental participant can review a completed rental and duplicate reviews are rejected', async () => {
  const product = await publish()
  const rental = await RentalRequest.create({ customerId: customer._id, items: [{ productId: product._id, providerId: shop._id, providerRole: 'rental_shop', title: product.title, decision: 'accepted' }], startDate: new Date(Date.now() - 86400000), endDate: new Date(), deliveryMethod: 'pickup', subtotal: 2500, total: 2500, status: 'active' })
  const body = { requestId: rental._id, productId: product._id, rating: 4, comment: 'Clean camera.' }
  const send = (user, extra = {}) => request(app).post('/api/reviews').set(auth(user)).send({ ...body, ...extra })
  assert.equal((await send(customer)).status, 409)
  await RentalRequest.updateOne({ _id: rental._id }, { status: 'completed' })
  assert.equal((await send(outsider)).status, 403)
  assert.equal((await send(customer, { rating: 4.5 })).status, 400)
  assert.equal((await send(customer)).status, 201)
  assert.equal((await send(customer)).status, 409)
  const stored = await Product.findById(product._id)
  assert.equal(stored.ratingAverage, 4); assert.equal(stored.ratingCount, 1)
})
