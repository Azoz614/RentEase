import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { RentalPackage } from '../products/rental-package.model.mjs'
import { User } from '../users/user.model.mjs'
import { Product } from '../products/product.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { AuditLog } from './audit-log.model.mjs'
import { recordAudit } from '../../services/audit.service.js'
import { Coupon } from '../payments/coupon.model.mjs'
import { SystemSetting } from './system-setting.model.mjs'
import { providerRentalRequests } from '../rentals/provider-rentals.service.mjs'
import {
  removeProductPhotos,
  saveProductPhotos,
  imageTypes,
} from '../products/product-images.service.mjs'

import { roles, publicUser } from './admin.service.mjs'
import { productUploadDirectory as uploadDir } from '../../config/paths.js'

export const getOverview = async (_req, res) => {
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 6)
  weekStart.setHours(0, 0, 0, 0)
  const [users, activeUsers, products, pendingShops, rolesSummary, categorySummary] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ $or: [{ active: true }, { active: { $exists: false } }] }),
      Product.countDocuments({ active: true }),
      User.countDocuments({ role: 'rental_shop', shopStatus: 'pending' }),
      User.aggregate([{ $group: { _id: { $ifNull: ['$role', 'user'] }, count: { $sum: 1 } } }]),
      Product.aggregate([
        { $match: { active: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
    ])
  const [newUsers, newProducts] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: weekStart } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Colombo' },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    Product.aggregate([
      { $match: { createdAt: { $gte: weekStart } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Colombo' },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ])
  res.json({
    users,
    activeUsers,
    products,
    pendingShops,
    roles: rolesSummary,
    categories: categorySummary,
    activity: { users: newUsers, products: newProducts },
  })
}

export const getSettings = async (_req, res) => {
  const settings = await SystemSetting.findOneAndUpdate(
    { key: 'platform' },
    { $setOnInsert: { key: 'platform' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
  res.json({
    settings: {
      ...settings,
      deliveryBaseFee: 0,
      deliveryPerKm: 50,
      deliveryPricingConfigured: true,
    },
  })
}

export const updateSettings = async (req, res) => {
  const fields = [
    'deliveryBaseFee',
    'deliveryPerKm',
    'returnCollectionBaseFee',
    'returnCollectionPerKm',
    'lateFeePerDay',
    'cancellationWindowHours',
  ]
  const updates = {}
  if (
    (req.body.deliveryBaseFee !== undefined && Number(req.body.deliveryBaseFee) !== 0) ||
    (req.body.deliveryPerKm !== undefined && Number(req.body.deliveryPerKm) !== 50)
  )
    return res
      .status(400)
      .json({ message: 'Delivery is fixed at LKR 50 per driving kilometer, with no base fee.' })
  if (req.body.deliveryBaseFee !== undefined || req.body.deliveryPerKm !== undefined) {
    if (req.body.deliveryBaseFee === undefined || req.body.deliveryPerKm === undefined)
      return res
        .status(400)
        .json({ message: 'Save both the delivery base fee and per-kilometer rate together.' })
    updates.deliveryPricingConfigured = true
  }
  for (const field of fields) {
    if (req.body[field] === undefined) continue
    if (req.body[field] === null || req.body[field] === '' || typeof req.body[field] === 'boolean')
      return res.status(400).json({ message: `Enter a valid ${field}.` })
    const value = Number(req.body[field])
    const maximum = field === 'cancellationWindowHours' ? 720 : 1_000_000
    if (!Number.isFinite(value) || value < 0 || value > maximum)
      return res.status(400).json({ message: `Enter a valid ${field}.` })
    if (
      [
        'deliveryBaseFee',
        'deliveryPerKm',
        'returnCollectionBaseFee',
        'returnCollectionPerKm',
      ].includes(field) &&
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
    )
      return res
        .status(400)
        .json({ message: 'Delivery rates must have no more than two decimal places.' })
    updates[field] = value
  }
  if (req.body.supportEmail !== undefined) {
    const email = String(req.body.supportEmail || '')
      .trim()
      .toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ message: 'Enter a valid support email or leave it blank.' })
    updates.supportEmail = email
  }
  if (req.body.maintenanceMode !== undefined) {
    if (typeof req.body.maintenanceMode !== 'boolean')
      return res.status(400).json({ message: 'Maintenance mode must be true or false.' })
    updates.maintenanceMode = req.body.maintenanceMode
  }
  if (!Object.keys(updates).length)
    return res.status(400).json({ message: 'Choose at least one setting to update.' })
  updates.updatedBy = req.user._id
  const settings = await SystemSetting.findOneAndUpdate(
    { key: 'platform' },
    { $set: updates, $setOnInsert: { key: 'platform' } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  )
  recordAudit(req, {
    action: 'system.settings.updated',
    entityType: 'system_setting',
    entityId: settings._id,
    summary: 'Updated platform operational settings.',
  })
  res.json({
    message: 'Platform settings saved. New rental quotes use these values immediately.',
    settings: {
      ...settings,
      deliveryBaseFee: 0,
      deliveryPerKm: 50,
      deliveryPricingConfigured: true,
    },
  })
}

export const getRevenueReport = async (_req, res) => {
  const [summary] = await RentalRequest.aggregate([
    {
      $group: {
        _id: null,
        bookings: { $sum: 1 },
        confirmedBookings: {
          $sum: {
            $cond: [{ $in: ['$status', ['confirmed', 'active', 'returned', 'completed']] }, 1, 0],
          },
        },
        rentalCollected: { $sum: '$payment.rentalPaid' },
        depositsHeld: { $sum: '$payment.depositHeld' },
        depositsRefunded: { $sum: '$payment.depositRefunded' },
        deliveryFees: { $sum: '$deliveryFee' },
      },
    },
  ])
  const byDay = await RentalRequest.aggregate([
    { $match: { 'payment.paidAt': { $type: 'date' } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$payment.paidAt', timezone: 'Asia/Colombo' },
        },
        revenue: { $sum: '$payment.rentalPaid' },
        bookings: { $sum: 1 },
      },
    },
    { $sort: { _id: -1 } },
    { $limit: 30 },
  ])
  const result = summary || {
    bookings: 0,
    confirmedBookings: 0,
    rentalCollected: 0,
    depositsHeld: 0,
    depositsRefunded: 0,
    deliveryFees: 0,
  }
  res.json({
    ...result,
    adjustmentsRetained: Math.max(
      0,
      Number(result.depositsHeld || 0) - Number(result.depositsRefunded || 0),
    ),
    byDay,
  })
}

export const listUsers = async (_req, res) => {
  const users = await User.find()
    .select('username email phone role shopName shopStatus active createdAt')
    .sort({ createdAt: -1 })
    .limit(250)
  res.json({ users })
}

export const listAuditEvents = async (_req, res) => {
  const events = await AuditLog.find()
    .populate('actorId', 'username email role')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean()
  res.json({ events })
}

export const listCoupons = async (_req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).limit(250).lean()
  res.json({ coupons })
}

export const createCoupon = async (req, res) => {
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : ''
  const kind = req.body.kind === 'percent' ? 'percent' : 'fixed'
  const value = Number(req.body.value)
  const minimumSubtotal = Number(req.body.minimumSubtotal || 0)
  const maximumDiscount =
    req.body.maximumDiscount === '' || req.body.maximumDiscount == null
      ? undefined
      : Number(req.body.maximumDiscount)
  const maxRedemptions =
    req.body.maxRedemptions === '' || req.body.maxRedemptions == null
      ? undefined
      : Number(req.body.maxRedemptions)
  const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined
  if (!/^[A-Z0-9_-]{3,32}$/.test(code))
    return res
      .status(400)
      .json({ message: 'Coupon code must use 3–32 letters, numbers, dashes, or underscores.' })
  if (!Number.isFinite(value) || value <= 0 || (kind === 'percent' && value > 100))
    return res
      .status(400)
      .json({ message: 'Enter a positive discount value (up to 100% for percentage coupons).' })
  if (
    !Number.isFinite(minimumSubtotal) ||
    minimumSubtotal < 0 ||
    (maximumDiscount !== undefined && (!Number.isFinite(maximumDiscount) || maximumDiscount < 0)) ||
    (maxRedemptions !== undefined && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) ||
    (expiresAt && !Number.isFinite(expiresAt.getTime()))
  )
    return res
      .status(400)
      .json({ message: 'Check the minimum spend, cap, redemption limit, and expiry date.' })
  try {
    const coupon = await Coupon.create({
      code,
      kind,
      value,
      minimumSubtotal,
      maximumDiscount,
      maxRedemptions,
      expiresAt,
    })
    recordAudit(req, {
      action: 'coupon.created',
      entityType: 'coupon',
      entityId: coupon._id,
      summary: `Created coupon ${coupon.code}.`,
    })
    res.status(201).json({ message: 'Coupon created.', coupon })
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ message: 'That coupon code already exists.' })
    throw error
  }
}

export const updateCoupon = async (req, res) => {
  if (typeof req.body.active !== 'boolean')
    return res.status(400).json({ message: 'Coupon status must be active or inactive.' })
  const coupon = await Coupon.findByIdAndUpdate(
    req.params.id,
    { active: req.body.active },
    { new: true },
  )
  if (!coupon) return res.status(404).json({ message: 'Coupon not found.' })
  recordAudit(req, {
    action: `coupon.${req.body.active ? 'activated' : 'paused'}`,
    entityType: 'coupon',
    entityId: coupon._id,
    summary: `${req.body.active ? 'Activated' : 'Paused'} coupon ${coupon.code}.`,
  })
  res.json({ message: 'Coupon updated.', coupon })
}

export const listPackages = async (_req, res) => {
  const packages = await RentalPackage.find()
    .populate('productIds', 'title category dailyRate photos active')
    .populate('optionalAddOnIds', 'title category dailyRate photos active')
    .sort({ createdAt: -1 })
    .lean()
  res.json({ packages })
}

export const createPackage = async (req, res) => {
  const { name, category, description } = req.body
  const productIds = Array.isArray(req.body.productIds)
    ? [...new Set(req.body.productIds.map(String))]
    : []
  const optionalAddOnIds = Array.isArray(req.body.optionalAddOnIds)
    ? [...new Set(req.body.optionalAddOnIds.map(String))]
    : []
  const dailyRate = Number(req.body.dailyRate),
    weeklyRate =
      req.body.weeklyRate === '' || req.body.weeklyRate == null
        ? undefined
        : Number(req.body.weeklyRate)
  if (![name, category, description].every((value) => typeof value === 'string' && value.trim()))
    return res
      .status(400)
      .json({ message: 'Package name, category, and description are required.' })
  if (
    !productIds.length ||
    [...productIds, ...optionalAddOnIds].some((id) => !mongoose.isValidObjectId(id)) ||
    productIds.some((id) => optionalAddOnIds.includes(id))
  )
    return res.status(400).json({ message: 'Choose required items and distinct optional add-ons.' })
  if (
    !Number.isFinite(dailyRate) ||
    dailyRate < 0 ||
    (weeklyRate !== undefined && (!Number.isFinite(weeklyRate) || weeklyRate < 0))
  )
    return res.status(400).json({ message: 'Enter valid package daily and weekly prices.' })
  const products = await Product.find({
    _id: { $in: [...productIds, ...optionalAddOnIds] },
    active: true,
  })
  if (products.length !== productIds.length + optionalAddOnIds.length)
    return res
      .status(400)
      .json({ message: 'Every required item and add-on must be an active listing.' })
  const startsAt = req.body.startsAt ? new Date(req.body.startsAt) : undefined
  const endsAt = req.body.endsAt ? new Date(req.body.endsAt) : undefined
  if (
    (startsAt && !Number.isFinite(startsAt.getTime())) ||
    (endsAt && !Number.isFinite(endsAt.getTime())) ||
    (startsAt && endsAt && startsAt >= endsAt)
  )
    return res.status(400).json({ message: 'Enter a valid promotion date range.' })
  const rentalPackage = await RentalPackage.create({
    name: name.trim(),
    category: category.trim(),
    description: description.trim(),
    productIds,
    optionalAddOnIds,
    dailyRate,
    weeklyRate,
    startsAt,
    endsAt,
  })
  recordAudit(req, {
    action: 'package.created',
    entityType: 'rental_package',
    entityId: rentalPackage._id,
    summary: `Created rental package ${rentalPackage.name}.`,
  })
  res.status(201).json({ message: 'Rental package created.', package: rentalPackage })
}

export const updatePackage = async (req, res) => {
  if (typeof req.body.active !== 'boolean')
    return res.status(400).json({ message: 'Package status must be active or inactive.' })
  const rentalPackage = await RentalPackage.findByIdAndUpdate(
    req.params.id,
    { active: req.body.active },
    { new: true },
  )
  if (!rentalPackage) return res.status(404).json({ message: 'Rental package not found.' })
  recordAudit(req, {
    action: `package.${req.body.active ? 'activated' : 'paused'}`,
    entityType: 'rental_package',
    entityId: rentalPackage._id,
    summary: `${req.body.active ? 'Activated' : 'Paused'} rental package ${rentalPackage.name}.`,
  })
  res.json({ message: 'Package updated.', package: rentalPackage })
}

export const createUser = async (req, res) => {
  try {
    const { username, email, phone, password, role } = req.body
    const shopName = typeof req.body.shopName === 'string' ? req.body.shopName.trim() : ''
    if (
      ![username, email, phone, password, role].every(
        (value) => typeof value === 'string' && value.trim(),
      )
    )
      return res
        .status(400)
        .json({ message: 'Name, email, phone, password, and role are required.' })
    if (!roles.includes(role))
      return res.status(400).json({ message: 'Choose a valid account type.' })
    if (password.length < 10)
      return res.status(400).json({ message: 'Password must be at least 10 characters.' })
    const user = await User.create({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      password: await bcrypt.hash(password, 12),
      role,
      shopName: role === 'rental_shop' ? shopName || username.trim() : '',
      shopStatus: role === 'rental_shop' ? 'approved' : 'not_applicable',
    })
    recordAudit(req, {
      action: 'account.created',
      entityType: 'user',
      entityId: user._id,
      summary: `Created ${role} account ${user.username}.`,
    })
    res.status(201).json({ message: 'Account created.', user: publicUser(user) })
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ message: 'That email or username is already registered.' })
    res.status(500).json({ message: 'Could not create the account.' })
  }
}

export const updateUser = async (req, res) => {
  const { role, active } = req.body
  if (role !== undefined && !roles.includes(role))
    return res.status(400).json({ message: 'Choose a valid account type.' })
  if (active !== undefined && typeof active !== 'boolean')
    return res.status(400).json({ message: 'Account status must be active or suspended.' })
  const target = await User.findById(req.params.id).select('role username shopName')
  if (!target) return res.status(404).json({ message: 'Account not found.' })
  if (target.role === 'admin')
    return res
      .status(400)
      .json({ message: 'Administrator accounts are protected from user management actions.' })
  const updates = {}
  if (role !== undefined) {
    updates.role = role
    updates.shopStatus = role === 'rental_shop' ? 'approved' : 'not_applicable'
    if (role === 'rental_shop' && !target.shopName) updates.shopName = target.username
  }
  if (active !== undefined) updates.active = active
  const user = await User.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  }).select('-password')
  if (!user) return res.status(404).json({ message: 'Account not found.' })
  recordAudit(req, {
    action: 'account.updated',
    entityType: 'user',
    entityId: user._id,
    summary: `Updated account ${user.username}.`,
  })
  res.json({ message: 'Account updated.', user: publicUser(user) })
}

export const listPendingShops = async (_req, res) => {
  const shops = await User.find({ role: 'rental_shop', shopStatus: 'pending' })
    .select('username email phone shopName createdAt')
    .sort({ createdAt: 1 })
    .lean()
  res.json({ shops })
}

export const listApprovedShops = async (_req, res) => {
  const shops = await User.find({ role: 'rental_shop', shopStatus: 'approved', active: true })
    .select('username shopName')
    .sort({ shopName: 1 })
    .lean()
  res.json({ shops })
}

export const listRentalRequests = async (req, res) => {
  const requests = await providerRentalRequests(req.user)
  res.set('Cache-Control', 'private, no-store')
  res.json({ requests })
}

export const reviewShop = async (req, res) => {
  const { decision } = req.body
  if (!['approved', 'rejected'].includes(decision))
    return res.status(400).json({ message: 'Choose approve or reject.' })
  const shop = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'rental_shop', shopStatus: 'pending' },
    { shopStatus: decision },
    { new: true },
  ).select('username email phone shopName shopStatus')
  if (!shop) return res.status(404).json({ message: 'Pending rental shop was not found.' })
  recordAudit(req, {
    action: `shop.${decision}`,
    entityType: 'user',
    entityId: shop._id,
    summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} rental shop ${shop.shopName}.`,
  })
  res.json({
    message:
      decision === 'approved' ? 'Rental shop approved.' : 'Rental shop application rejected.',
    shop,
  })
}

export const listProducts = async (_req, res) => {
  const products = await Product.find()
    .sort({ createdAt: -1 })
    .populate('createdBy', 'username')
    .limit(300)
    .lean()
  res.json({ products })
}

export const updateProduct = async (req, res) => {
  const updates = {}
  for (const field of ['title', 'category', 'description']) {
    if (req.body[field] !== undefined) {
      if (typeof req.body[field] !== 'string' || !req.body[field].trim())
        return res.status(400).json({ message: `${field} cannot be empty.` })
      updates[field] = req.body[field].trim()
    }
  }
  if (req.body.dailyRate !== undefined) {
    const dailyRate = Number(req.body.dailyRate)
    if (!Number.isFinite(dailyRate) || dailyRate < 0)
      return res.status(400).json({ message: 'Enter a valid daily rental price.' })
    updates.dailyRate = dailyRate
  }
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== 'boolean')
      return res.status(400).json({ message: 'Listing status must be active or inactive.' })
    updates.active = req.body.active
  }
  const existing = await Product.findById(req.params.id)
  if (!existing) return res.status(404).json({ message: 'Product not found.' })
  let newImagePaths = [],
    removedImagePaths = []
  if (req.body.photos !== undefined) {
    try {
      const result = await saveProductPhotos(req.body.photos, existing.photos, uploadDir)
      updates.photos = result.photos
      newImagePaths = result.newPaths
      removedImagePaths = existing.photos.filter((photo) => !result.photos.includes(photo))
    } catch (error) {
      return res
        .status(error.status || 500)
        .json({ message: error.status ? error.message : 'Could not save the product photos.' })
    }
  }
  let product
  try {
    product = await Product.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    })
  } catch (error) {
    await removeProductPhotos(newImagePaths, uploadDir)
    throw error
  }
  if (!product) return res.status(404).json({ message: 'Product not found.' })
  await removeProductPhotos(removedImagePaths, uploadDir)
  recordAudit(req, {
    action: 'product.updated',
    entityType: 'product',
    entityId: product._id,
    summary: `Updated product listing ${product.title}.`,
  })
  res.json({ message: 'Product updated.', product })
}

export const createProduct = async (req, res) => {
  const { title, category, description, dailyRate, photos } = req.body
  const price = Number(dailyRate)
  const leadTimeHours = Number(req.body.leadTimeHours ?? 24)
  const specifications = Array.isArray(req.body.specifications)
    ? req.body.specifications
        .slice(0, 20)
        .map((specification) => ({
          name: String(specification?.name || '').trim(),
          value: String(specification?.value || '').trim(),
        }))
        .filter((specification) => specification.name && specification.value)
    : []
  if (![title, category, description].every((value) => typeof value === 'string' && value.trim()))
    return res
      .status(400)
      .json({ message: 'Product name, category, and description are required.' })
  if (!Number.isFinite(price) || price < 0)
    return res.status(400).json({ message: 'Enter a valid daily rental price.' })
  if (!Number.isFinite(leadTimeHours) || leadTimeHours < 0 || leadTimeHours > 720)
    return res.status(400).json({ message: 'Enter a delivery lead time from 0 to 720 hours.' })
  if (req.body.providerId && !mongoose.isValidObjectId(req.body.providerId))
    return res.status(400).json({ message: 'Choose a valid rental provider.' })
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 6)
    return res.status(400).json({ message: 'Add between 1 and 6 product photos.' })
  const savedPaths = []
  try {
    const imageBuffers = photos.map((photo) => {
      const match =
        typeof photo === 'string' &&
        photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
      if (!match || !imageTypes[match[1]]) throw new Error('Use JPEG, PNG, or WebP product photos.')
      const buffer = Buffer.from(match[2], 'base64')
      if (!buffer.length || buffer.length > 3 * 1024 * 1024)
        throw new Error('Each photo must be smaller than 3 MB.')
      return { buffer, extension: imageTypes[match[1]] }
    })
    await mkdir(uploadDir, { recursive: true })
    for (const image of imageBuffers) {
      const filename = `${randomUUID()}.${image.extension}`
      await writeFile(path.join(uploadDir, filename), image.buffer, { flag: 'wx' })
      savedPaths.push(`/uploads/products/${filename}`)
    }
    const provider = req.body.providerId
      ? await User.findOne({
          _id: req.body.providerId,
          role: 'rental_shop',
          shopStatus: 'approved',
          active: true,
        })
      : null
    if (req.body.providerId && !provider)
      throw new Error('Choose an active, approved rental shop as provider.')
    const product = await Product.create({
      title: title.trim(),
      category: category.trim(),
      description: description.trim(),
      dailyRate: price,
      leadTimeHours,
      specifications,
      location: (provider || req.user).shopAddress || 'Shop location not confirmed',
      photos: savedPaths,
      createdBy: req.user._id,
      providerId: provider?._id || req.user._id,
    })
    recordAudit(req, {
      action: 'product.created',
      entityType: 'product',
      entityId: product._id,
      summary: `Created product listing ${product.title}.`,
    })
    res.status(201).json({ message: 'Product published.', product })
  } catch (error) {
    console.error('Admin product creation failed:', error)
    await Promise.all(
      savedPaths.map((savedPath) =>
        unlink(path.join(uploadDir, path.basename(savedPath))).catch(() => {}),
      ),
    )
    res
      .status(
        error.message.startsWith('Use JPEG') || error.message.startsWith('Each photo') ? 400 : 500,
      )
      .json({
        message:
          error.message.startsWith('Use JPEG') || error.message.startsWith('Each photo')
            ? error.message
            : 'Could not publish this product.',
      })
  }
}

export const deactivateProduct = async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true })
  if (!product) return res.status(404).json({ message: 'Product not found.' })
  recordAudit(req, {
    action: 'product.deactivated',
    entityType: 'product',
    entityId: product._id,
    summary: `Deactivated product listing ${product.title}.`,
  })
  res.json({ message: 'Product removed from active listings.' })
}
