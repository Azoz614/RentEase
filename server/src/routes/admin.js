import { Router } from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RentalPackage } from '../model/rentalPackage.mjs'
import { User } from '../model/user.mjs'
import { Product } from '../model/product.mjs'
import { RentalRequest } from '../model/rentalRequest.mjs'
import { requireAdmin, requireUser } from '../middleware/auth.mjs'
import { AuditLog } from '../model/auditLog.mjs'
import { recordAudit } from '../config/audit.js'
import { Coupon } from '../model/coupon.mjs'
import { createReadStream } from 'node:fs'

const router = Router()
const uploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/products')
const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const roles = ['user', 'delivery_partner', 'rental_shop']
const identityDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../private/identity')

router.use(requireUser, requireAdmin)

router.get('/overview', async (_req, res) => {
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 6)
  weekStart.setHours(0, 0, 0, 0)
  const [users, activeUsers, products, pendingShops, rolesSummary, categorySummary] = await Promise.all([
    User.countDocuments(), User.countDocuments({ $or: [{ active: true }, { active: { $exists: false } }] }), Product.countDocuments({ active: true }),
    User.countDocuments({ role: 'rental_shop', shopStatus: 'pending' }),
    User.aggregate([{ $group: { _id: { $ifNull: ['$role', 'user'] }, count: { $sum: 1 } } }]),
    Product.aggregate([{ $match: { active: true } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]),
  ])
  const [newUsers, newProducts] = await Promise.all([
    User.aggregate([{ $match: { createdAt: { $gte: weekStart } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Colombo' } }, count: { $sum: 1 } } }]),
    Product.aggregate([{ $match: { createdAt: { $gte: weekStart } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Colombo' } }, count: { $sum: 1 } } }]),
  ])
  res.json({ users, activeUsers, products, pendingShops, roles: rolesSummary, categories: categorySummary, activity: { users: newUsers, products: newProducts } })
})

router.get('/users', async (_req, res) => {
  const users = await User.find().select('username email phone role shopName shopStatus active createdAt').sort({ createdAt: -1 }).limit(250)
  res.json({ users })
})

router.get('/audit', async (_req, res) => {
  const events = await AuditLog.find().populate('actorId', 'username email role').sort({ createdAt: -1 }).limit(300).lean()
  res.json({ events })
})

router.get('/coupons', async (_req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).limit(250).lean()
  res.json({ coupons })
})

router.get('/identity/pending', async (_req, res) => {
  const users = await User.find({ identityStatus: 'pending' }).select('username email phone nic identitySubmittedAt').sort({ identitySubmittedAt: 1 }).lean()
  res.json({ users })
})

router.get('/identity/:id/:side', async (req, res) => {
  if (!['front', 'back'].includes(req.params.side) || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Choose a valid identity document.' })
  const field = req.params.side === 'front' ? 'identityFrontPath' : 'identityBackPath'
  const user = await User.findOne({ _id: req.params.id, identityStatus: 'pending' }).select(field)
  const filename = user?.[field]
  if (!filename || path.basename(filename) !== filename) return res.status(404).json({ message: 'Identity document not found.' })
  const extension = path.extname(filename).toLowerCase()
  const contentTypes = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
  res.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'private, no-store')
  createReadStream(path.join(identityDir, filename)).on('error', () => { if (!res.headersSent) res.status(404).end() }).pipe(res)
})

router.patch('/identity/:id/review', async (req, res) => {
  const { decision } = req.body
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 500) : ''
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Choose approve or reject.' })
  const user = await User.findOneAndUpdate({ _id: req.params.id, identityStatus: 'pending' }, { identityStatus: decision, identityReviewNote: note }, { new: true }).select('username email phone identityStatus identityReviewNote')
  if (!user) return res.status(404).json({ message: 'Pending identity application not found.' })
  recordAudit(req, { action: `identity.${decision}`, entityType: 'user', entityId: user._id, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} identity verification for ${user.username}.` })
  res.json({ message: `Identity verification ${decision}.`, user })
})

router.post('/coupons', async (req, res) => {
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : ''
  const kind = req.body.kind === 'percent' ? 'percent' : 'fixed'
  const value = Number(req.body.value)
  const minimumSubtotal = Number(req.body.minimumSubtotal || 0)
  const maximumDiscount = req.body.maximumDiscount === '' || req.body.maximumDiscount == null ? undefined : Number(req.body.maximumDiscount)
  const maxRedemptions = req.body.maxRedemptions === '' || req.body.maxRedemptions == null ? undefined : Number(req.body.maxRedemptions)
  const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return res.status(400).json({ message: 'Coupon code must use 3–32 letters, numbers, dashes, or underscores.' })
  if (!Number.isFinite(value) || value <= 0 || (kind === 'percent' && value > 100)) return res.status(400).json({ message: 'Enter a positive discount value (up to 100% for percentage coupons).' })
  if (!Number.isFinite(minimumSubtotal) || minimumSubtotal < 0 || (maximumDiscount !== undefined && (!Number.isFinite(maximumDiscount) || maximumDiscount < 0)) || (maxRedemptions !== undefined && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) || (expiresAt && !Number.isFinite(expiresAt.getTime()))) return res.status(400).json({ message: 'Check the minimum spend, cap, redemption limit, and expiry date.' })
  try {
    const coupon = await Coupon.create({ code, kind, value, minimumSubtotal, maximumDiscount, maxRedemptions, expiresAt })
    recordAudit(req, { action: 'coupon.created', entityType: 'coupon', entityId: coupon._id, summary: `Created coupon ${coupon.code}.` })
    res.status(201).json({ message: 'Coupon created.', coupon })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That coupon code already exists.' })
    throw error
  }
})

router.patch('/coupons/:id', async (req, res) => {
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'Coupon status must be active or inactive.' })
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, { active: req.body.active }, { new: true })
  if (!coupon) return res.status(404).json({ message: 'Coupon not found.' })
  recordAudit(req, { action: `coupon.${req.body.active ? 'activated' : 'paused'}`, entityType: 'coupon', entityId: coupon._id, summary: `${req.body.active ? 'Activated' : 'Paused'} coupon ${coupon.code}.` })
  res.json({ message: 'Coupon updated.', coupon })
})

router.get('/packages', async (_req, res) => {
  const packages = await RentalPackage.find().populate('productIds', 'title category dailyRate photos active').populate('optionalAddOnIds', 'title category dailyRate photos active').sort({ createdAt: -1 }).lean()
  res.json({ packages })
})

router.post('/packages', async (req, res) => {
  const { name, category, description } = req.body
  const productIds = Array.isArray(req.body.productIds) ? [...new Set(req.body.productIds.map(String))] : []
  const optionalAddOnIds = Array.isArray(req.body.optionalAddOnIds) ? [...new Set(req.body.optionalAddOnIds.map(String))] : []
  const dailyRate = Number(req.body.dailyRate), weeklyRate = req.body.weeklyRate === '' || req.body.weeklyRate == null ? undefined : Number(req.body.weeklyRate)
  if (![name, category, description].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Package name, category, and description are required.' })
  if (!productIds.length || [...productIds, ...optionalAddOnIds].some((id) => !mongoose.isValidObjectId(id)) || productIds.some((id) => optionalAddOnIds.includes(id))) return res.status(400).json({ message: 'Choose required items and distinct optional add-ons.' })
  if (!Number.isFinite(dailyRate) || dailyRate < 0 || (weeklyRate !== undefined && (!Number.isFinite(weeklyRate) || weeklyRate < 0))) return res.status(400).json({ message: 'Enter valid package daily and weekly prices.' })
  const products = await Product.find({ _id: { $in: [...productIds, ...optionalAddOnIds] }, active: true })
  if (products.length !== productIds.length + optionalAddOnIds.length) return res.status(400).json({ message: 'Every required item and add-on must be an active listing.' })
  const startsAt = req.body.startsAt ? new Date(req.body.startsAt) : undefined
  const endsAt = req.body.endsAt ? new Date(req.body.endsAt) : undefined
  if ((startsAt && !Number.isFinite(startsAt.getTime())) || (endsAt && !Number.isFinite(endsAt.getTime())) || (startsAt && endsAt && startsAt >= endsAt)) return res.status(400).json({ message: 'Enter a valid promotion date range.' })
  const rentalPackage = await RentalPackage.create({ name: name.trim(), category: category.trim(), description: description.trim(), productIds, optionalAddOnIds, dailyRate, weeklyRate, startsAt, endsAt })
  recordAudit(req, { action: 'package.created', entityType: 'rental_package', entityId: rentalPackage._id, summary: `Created rental package ${rentalPackage.name}.` })
  res.status(201).json({ message: 'Rental package created.', package: rentalPackage })
})

router.patch('/packages/:id', async (req, res) => {
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'Package status must be active or inactive.' })
  const rentalPackage = await RentalPackage.findByIdAndUpdate(req.params.id, { active: req.body.active }, { new: true })
  if (!rentalPackage) return res.status(404).json({ message: 'Rental package not found.' })
  recordAudit(req, { action: `package.${req.body.active ? 'activated' : 'paused'}`, entityType: 'rental_package', entityId: rentalPackage._id, summary: `${req.body.active ? 'Activated' : 'Paused'} rental package ${rentalPackage.name}.` })
  res.json({ message: 'Package updated.', package: rentalPackage })
})

router.post('/users', async (req, res) => {
  try {
    const { username, email, phone, password, role } = req.body
    const shopName = typeof req.body.shopName === 'string' ? req.body.shopName.trim() : ''
    if (![username, email, phone, password, role].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Name, email, phone, password, and role are required.' })
    if (!roles.includes(role)) return res.status(400).json({ message: 'Choose a valid account type.' })
    if (password.length < 10) return res.status(400).json({ message: 'Password must be at least 10 characters.' })
    const user = await User.create({
      username: username.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password: await bcrypt.hash(password, 12),
      role, shopName: role === 'rental_shop' ? (shopName || username.trim()) : '', shopStatus: role === 'rental_shop' ? 'approved' : 'not_applicable',
    })
    recordAudit(req, { action: 'account.created', entityType: 'user', entityId: user._id, summary: `Created ${role} account ${user.username}.` })
    res.status(201).json({ message: 'Account created.', user: publicUser(user) })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That email or username is already registered.' })
    res.status(500).json({ message: 'Could not create the account.' })
  }
})

router.patch('/users/:id', async (req, res) => {
  const { role, active } = req.body
  if (role !== undefined && !roles.includes(role)) return res.status(400).json({ message: 'Choose a valid account type.' })
  if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ message: 'Account status must be active or suspended.' })
  const target = await User.findById(req.params.id).select('role username shopName')
  if (!target) return res.status(404).json({ message: 'Account not found.' })
  if (target.role === 'admin') return res.status(400).json({ message: 'Administrator accounts are protected from user management actions.' })
  const updates = {}
  if (role !== undefined) {
    updates.role = role
    updates.shopStatus = role === 'rental_shop' ? 'approved' : 'not_applicable'
    if (role === 'rental_shop' && !target.shopName) updates.shopName = target.username
  }
  if (active !== undefined) updates.active = active
  const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).select('-password')
  if (!user) return res.status(404).json({ message: 'Account not found.' })
  recordAudit(req, { action: 'account.updated', entityType: 'user', entityId: user._id, summary: `Updated account ${user.username}.` })
  res.json({ message: 'Account updated.', user: publicUser(user) })
})

router.get('/shops/pending', async (_req, res) => {
  const shops = await User.find({ role: 'rental_shop', shopStatus: 'pending' }).select('username email phone shopName createdAt').sort({ createdAt: 1 }).lean()
  res.json({ shops })
})

router.get('/shops/approved', async (_req, res) => {
  const shops = await User.find({ role: 'rental_shop', shopStatus: 'approved', active: true }).select('username shopName').sort({ shopName: 1 }).lean()
  res.json({ shops })
})

router.get('/rental-requests', async (_req, res) => {
  const requests = await RentalRequest.find({ 'items.providerId': _req.user._id }).populate('customerId', 'username email phone').sort({ createdAt: -1 }).limit(100).lean()
  res.json({ requests })
})

router.patch('/shops/:id/review', async (req, res) => {
  const { decision } = req.body
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Choose approve or reject.' })
  const shop = await User.findOneAndUpdate({ _id: req.params.id, role: 'rental_shop', shopStatus: 'pending' }, { shopStatus: decision }, { new: true }).select('username email phone shopName shopStatus')
  if (!shop) return res.status(404).json({ message: 'Pending rental shop was not found.' })
  recordAudit(req, { action: `shop.${decision}`, entityType: 'user', entityId: shop._id, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} rental shop ${shop.shopName}.` })
  res.json({ message: decision === 'approved' ? 'Rental shop approved.' : 'Rental shop application rejected.', shop })
})

router.get('/products', async (_req, res) => {
  const products = await Product.find().sort({ createdAt: -1 }).populate('createdBy', 'username').limit(300).lean()
  res.json({ products })
})

router.patch('/products/:id', async (req, res) => {
  const updates = {}
  for (const field of ['title', 'category', 'description']) {
    if (req.body[field] !== undefined) {
      if (typeof req.body[field] !== 'string' || !req.body[field].trim()) return res.status(400).json({ message: `${field} cannot be empty.` })
      updates[field] = req.body[field].trim()
    }
  }
  if (req.body.dailyRate !== undefined) {
    const dailyRate = Number(req.body.dailyRate)
    if (!Number.isFinite(dailyRate) || dailyRate < 0) return res.status(400).json({ message: 'Enter a valid daily rental price.' })
    updates.dailyRate = dailyRate
  }
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'Listing status must be active or inactive.' })
    updates.active = req.body.active
  }
  const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
  if (!product) return res.status(404).json({ message: 'Product not found.' })
  recordAudit(req, { action: 'product.updated', entityType: 'product', entityId: product._id, summary: `Updated product listing ${product.title}.` })
  res.json({ message: 'Product updated.', product })
})

router.post('/products', async (req, res) => {
  const { title, category, description, dailyRate, photos } = req.body
  const price = Number(dailyRate)
  const leadTimeHours = Number(req.body.leadTimeHours ?? 24)
  if (![title, category, description].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Product name, category, and description are required.' })
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: 'Enter a valid daily rental price.' })
  if (!Number.isFinite(leadTimeHours) || leadTimeHours < 0 || leadTimeHours > 720) return res.status(400).json({ message: 'Enter a delivery lead time from 0 to 720 hours.' })
  if (req.body.providerId && !mongoose.isValidObjectId(req.body.providerId)) return res.status(400).json({ message: 'Choose a valid rental provider.' })
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 6) return res.status(400).json({ message: 'Add between 1 and 6 product photos.' })
  const savedPaths = []
  try {
    const imageBuffers = photos.map((photo) => {
      const match = typeof photo === 'string' && photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
      if (!match || !imageTypes[match[1]]) throw new Error('Use JPEG, PNG, or WebP product photos.')
      const buffer = Buffer.from(match[2], 'base64')
      if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('Each photo must be smaller than 3 MB.')
      return { buffer, extension: imageTypes[match[1]] }
    })
    await mkdir(uploadDir, { recursive: true })
    for (const image of imageBuffers) {
      const filename = `${randomUUID()}.${image.extension}`
      await writeFile(path.join(uploadDir, filename), image.buffer, { flag: 'wx' })
      savedPaths.push(`/uploads/products/${filename}`)
    }
    const provider = req.body.providerId ? await User.findOne({ _id: req.body.providerId, role: 'rental_shop', shopStatus: 'approved', active: true }) : null
    if (req.body.providerId && !provider) throw new Error('Choose an active, approved rental shop as provider.')
    const product = await Product.create({ title: title.trim(), category: category.trim(), description: description.trim(), dailyRate: price, leadTimeHours, location: 'Batticaloa', photos: savedPaths, createdBy: req.user._id, providerId: provider?._id || req.user._id })
    recordAudit(req, { action: 'product.created', entityType: 'product', entityId: product._id, summary: `Created product listing ${product.title}.` })
    res.status(201).json({ message: 'Product published.', product })
  } catch (error) {
    console.error('Admin product creation failed:', error)
    await Promise.all(savedPaths.map((savedPath) => unlink(path.join(uploadDir, path.basename(savedPath))).catch(() => {})))
    res.status(error.message.startsWith('Use JPEG') || error.message.startsWith('Each photo') ? 400 : 500).json({ message: error.message.startsWith('Use JPEG') || error.message.startsWith('Each photo') ? error.message : 'Could not publish this product.' })
  }
})

router.delete('/products/:id', async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true })
  if (!product) return res.status(404).json({ message: 'Product not found.' })
  recordAudit(req, { action: 'product.deactivated', entityType: 'product', entityId: product._id, summary: `Deactivated product listing ${product.title}.` })
  res.json({ message: 'Product removed from active listings.' })
})

function publicUser(user) {
  const value = user.toObject ? user.toObject() : user
  delete value.password
  return value
}

export default router
