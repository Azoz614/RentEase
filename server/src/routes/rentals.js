import { Router } from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { requireUser } from '../middleware/auth.mjs'
import { Product } from '../model/product.mjs'
import { RentalRequest } from '../model/rentalRequest.mjs'
import { Notification } from '../model/notification.mjs'
import { User } from '../model/user.mjs'
import { sendAccountOtp, sendRentalNotice, sendRentalSms } from '../config/mailer.js'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recordAudit } from '../config/audit.js'
import { Coupon } from '../model/coupon.mjs'
import { RentalReview } from '../model/rentalReview.mjs'
import { AccountOtp } from '../model/accountOtp.mjs'

const router = Router()
router.get('/public/products', async (_req, res) => {
  const products = await Product.find({ active: true }).select('title category description dailyRate hourlyRate weeklyRate longRentalDiscountPercent depositAmount ratingAverage ratingCount specifications location photos providerId leadTimeHours createdAt').populate('providerId', 'username shopName').sort({ createdAt: -1 }).lean()
  res.json({ products: products.map((product) => ({ ...product, available: true })) })
})
router.get('/public/reviews/product/:productId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Choose a valid listing.' })
  const reviews = await RentalReview.find({ productId: req.params.productId, direction: 'customer_to_owner' }).populate('authorId', 'username').sort({ createdAt: -1 }).limit(50).lean()
  res.json({ reviews })
})
router.use(requireUser)
const ownerUploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/products')
const identityUploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../private/identity')
const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const batticaloa = { latitude: 7.7102, longitude: 81.6924 }
const validPoint = (point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
const overlap = (slot, start, end) => slot.status !== 'rejected' && new Date(slot.startDate) < end && new Date(slot.endDate) > start
const publicRequest = (request) => request.toObject ? request.toObject() : request
const otpSecret = () => process.env.OTP_SECRET || process.env.SESSION_SECRET
const hashAccountOtp = (userId, purpose, otp, targetEmail = '') => createHmac('sha256', otpSecret()).update(`${userId}:${purpose}:${targetEmail}:${otp}`).digest('hex')

async function verifyAccountChange(req, purpose) {
  if (typeof req.body.password === 'string' && req.body.password) {
    const account = await User.findById(req.user._id).select('password')
    if (!account || !(await bcrypt.compare(req.body.password, account.password))) throw Object.assign(new Error('The current password is incorrect.'), { status: 401 })
    return
  }
  const otp = typeof req.body.verificationOtp === 'string' ? req.body.verificationOtp.trim() : ''
  if (!/^\d{6}$/.test(otp)) throw Object.assign(new Error('Enter your current password or request and enter the email verification code.'), { status: 400 })
  await consumeAccountOtp(req.user._id, purpose, otp)
}

async function consumeAccountOtp(userId, purpose, otp, targetEmail = '') {
  const record = await AccountOtp.findOne({ userId, purpose, targetEmail })
  if (!record || record.expiresAt <= new Date()) throw Object.assign(new Error('Your verification code has expired. Request a new one.'), { status: 400 })
  if (record.attempts >= 5) throw Object.assign(new Error('Too many incorrect codes. Request a new verification code.'), { status: 429 })
  const expected = Buffer.from(record.otpHash, 'hex')
  const submitted = Buffer.from(hashAccountOtp(userId, purpose, otp, targetEmail), 'hex')
  if (expected.length !== submitted.length || !timingSafeEqual(expected, submitted)) {
    record.attempts += 1
    await record.save()
    throw Object.assign(new Error('That verification code is incorrect.'), { status: 400 })
  }
  await record.deleteOne()
}

async function notify(user, requestId, title, body) {
  if (!user) return
  try { await Notification.create({ userId: user._id, requestId, title, body }) }
  catch (error) { console.error('Could not save in-app rental notification:', error.message) }
  sendRentalNotice(user.email, title, body).catch((error) => console.error('Rental email notification failed:', error.message))
  sendRentalSms(user.phone, title, body).catch((error) => console.error('Rental SMS notification failed:', error.message))
}

async function routeInfo(origin, destination) {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return { distanceKm: 0, etaMinutes: 0, mapsConfigured: false }
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
    body: JSON.stringify({ origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } }, destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } }, travelMode: 'DRIVE', languageCode: 'en-US', regionCode: 'LK' }),
  })
  if (!response.ok) throw new Error('Google Routes could not calculate this delivery route. Check the Maps API key, billing, and Routes API access.')
  const route = (await response.json()).routes?.[0]
  if (!route) throw new Error('No driving route was found for this address.')
  return { distanceKm: route.distanceMeters / 1000, etaMinutes: Math.ceil(parseFloat(route.duration) / 60), mapsConfigured: true }
}

async function routesForProducts(products, destination) {
  const origins = new Map()
  for (const product of products) {
    const origin = product.coordinates || batticaloa
    origins.set(`${origin.latitude},${origin.longitude}`, origin)
  }
  return Promise.all([...origins.values()].map((origin) => routeInfo(origin, destination)))
}

async function priceCoupon(codeValue, subtotal) {
  const code = typeof codeValue === 'string' ? codeValue.trim().toUpperCase() : ''
  if (!code) return { coupon: null, discountAmount: 0 }
  const coupon = await Coupon.findOne({ code, active: true, startsAt: { $lte: new Date() }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] })
  if (!coupon || (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions)) throw new Error('This coupon is invalid, expired, or fully redeemed.')
  if (subtotal < coupon.minimumSubtotal) throw new Error(`This coupon requires a rental subtotal of at least LKR ${coupon.minimumSubtotal.toLocaleString()}.`)
  let discountAmount = coupon.kind === 'percent' ? subtotal * coupon.value / 100 : coupon.value
  if (coupon.maximumDiscount != null) discountAmount = Math.min(discountAmount, coupon.maximumDiscount)
  discountAmount = Math.min(subtotal, Math.round(discountAmount))
  return { coupon, discountAmount }
}

router.get('/products', async (req, res) => {
  const products = await Product.find({ active: true }).populate('providerId', 'username shopName').sort({ createdAt: -1 }).lean()
  const start = req.query.startDate ? new Date(req.query.startDate) : null
  const end = req.query.endDate ? new Date(req.query.endDate) : null
  if (end && (!Number.isFinite(start?.getTime()) || !Number.isFinite(end.getTime()) || start >= end || start < new Date(new Date().setHours(0, 0, 0, 0)))) return res.status(400).json({ message: 'Choose valid rental start and end dates to check availability.' })
  const origin = req.user.addressLocation && validPoint(req.user.addressLocation) ? req.user.addressLocation : null
  res.json({ products: products.map((product) => {
    const { rentalSlots, ...publicProduct } = product
    const distanceKm = origin ? haversine(origin, product.coordinates || batticaloa) : null
    const estimatedDeliveryFee = distanceKm == null ? null : Math.round(Number(process.env.DELIVERY_BASE_FEE_LKR || 250) + distanceKm * Number(process.env.DELIVERY_PER_KM_LKR || 80))
    return { ...publicProduct, coordinates: validPoint(product.coordinates) ? product.coordinates : batticaloa,
      available: !(start && end) || !rentalSlots?.some((slot) => overlap(slot, start, end)),
      distanceKm, estimatedDeliveryFee }
  }), address: req.user.defaultAddress || '', nic: req.user.nic || '', loyaltyPoints: req.user.loyaltyPoints || 0, mapsConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY) })
})

router.get('/wishlist', async (req, res) => {
  const user = await User.findById(req.user._id).select('wishlist')
  const products = await Product.find({ _id: { $in: user?.wishlist || [] }, active: true }).populate('providerId', 'username shopName').lean()
  res.json({ products })
})

router.put('/wishlist/:productId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Choose a valid listing.' })
  if (!await Product.exists({ _id: req.params.productId, active: true })) return res.status(404).json({ message: 'This listing is not available to save.' })
  await User.updateOne({ _id: req.user._id }, { $addToSet: { wishlist: req.params.productId } })
  res.json({ message: 'Listing saved to your wishlist.' })
})

router.delete('/wishlist/:productId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Choose a valid listing.' })
  await User.updateOne({ _id: req.user._id }, { $pull: { wishlist: req.params.productId } })
  res.json({ message: 'Listing removed from your wishlist.' })
})

router.get('/reviews/product/:productId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Choose a valid listing.' })
  const reviews = await RentalReview.find({ productId: req.params.productId, direction: 'customer_to_owner' }).populate('authorId', 'username').sort({ createdAt: -1 }).limit(50).lean()
  res.json({ reviews })
})

router.post('/reviews', async (req, res) => {
  const { requestId, productId } = req.body
  const rating = Number(req.body.rating)
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : ''
  if (!mongoose.isValidObjectId(requestId) || !mongoose.isValidObjectId(productId)) return res.status(400).json({ message: 'Choose a valid completed rental item.' })
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1200) return res.status(400).json({ message: 'Choose a 1–5 star rating and keep your comment under 1200 characters.' })
  const request = await RentalRequest.findById(requestId)
  const item = request?.items.find((entry) => String(entry.productId) === String(productId))
  if (!request || !item || item.decision !== 'accepted') return res.status(404).json({ message: 'Completed rental item not found.' })
  const complete = item.deliveryStatus === 'returned' || new Date(request.endDate) <= new Date()
  if (!complete) return res.status(409).json({ message: 'Reviews open after the rental period is complete.' })
  const isCustomer = String(request.customerId) === String(req.user._id)
  const isOwner = String(item.providerId) === String(req.user._id)
  if (!isCustomer && !isOwner) return res.status(403).json({ message: 'Only the renter or listing provider can review this rental.' })
  const targetId = isCustomer ? item.providerId : request.customerId
  try {
    const review = await RentalReview.create({ requestId, productId, authorId: req.user._id, targetId, direction: isCustomer ? 'customer_to_owner' : 'owner_to_customer', rating, comment })
    if (isCustomer) {
      const [summary] = await RentalReview.aggregate([{ $match: { productId: new mongoose.Types.ObjectId(productId), direction: 'customer_to_owner' } }, { $group: { _id: '$productId', average: { $avg: '$rating' }, count: { $sum: 1 } } }])
      if (summary) await Product.updateOne({ _id: productId }, { $set: { ratingAverage: summary.average, ratingCount: summary.count } })
    }
    const received = await RentalReview.aggregate([{ $match: { targetId: new mongoose.Types.ObjectId(targetId) } }, { $group: { _id: '$targetId', average: { $avg: '$rating' } } }])
    if (received[0]) await User.updateOne({ _id: targetId }, { $set: { trustScore: Math.round(received[0].average * 20) } })
    const target = await User.findById(targetId).select('email phone username')
    await notify(target, request._id, 'New rental review', `${req.user.username} left you a ${rating}-star review.`)
    recordAudit(req, { action: 'review.created', entityType: 'rental_request', entityId: request._id, summary: `Submitted a ${rating}-star rental review.` })
    res.status(201).json({ message: 'Thank you. Your review has been saved.', review })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'You already reviewed this rental item.' })
    throw error
  }
})

router.post('/account/otp/send', async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Customer account security is only available to customer accounts.' })
  const purpose = req.body.purpose
  if (!['profile_update', 'password_change'].includes(purpose)) return res.status(400).json({ message: 'Choose a valid account change to verify.' })
  if (!otpSecret()) return res.status(503).json({ message: 'Email verification is not configured. Set OTP_SECRET and email settings.' })
  const previous = await AccountOtp.findOne({ userId: req.user._id, purpose, targetEmail: '' })
  if (previous && Date.now() - previous.updatedAt.getTime() < 60_000) return res.status(429).json({ message: 'Wait one minute before requesting another code.' })
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await AccountOtp.findOneAndUpdate({ userId: req.user._id, purpose }, { $set: { targetEmail: '', otpHash: hashAccountOtp(req.user._id, purpose, otp), expiresAt: new Date(Date.now() + 10 * 60_000), attempts: 0 } }, { upsert: true, new: true, setDefaultsOnInsert: true })
  try { await sendAccountOtp(req.user.email, otp, purpose) }
  catch (error) { await AccountOtp.deleteOne({ userId: req.user._id, purpose }); console.error('Account verification email failed:', error.message); return res.status(503).json({ message: 'Could not send the verification code. Check the email settings and try again.' }) }
  res.json({ message: `A verification code was sent to ${req.user.email}.` })
})

router.post('/account/email-otp/send', async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Customer account settings are only available to customer accounts.' })
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid new email address.' })
  if (email === req.user.email) return res.status(400).json({ message: 'This is already your account email.' })
  if (await User.exists({ email })) return res.status(409).json({ message: 'Another account already uses this email address.' })
  if (!otpSecret()) return res.status(503).json({ message: 'Email verification is not configured. Set OTP_SECRET and email settings.' })
  const previous = await AccountOtp.findOne({ userId: req.user._id, purpose: 'email_change', targetEmail: email })
  if (previous && Date.now() - previous.updatedAt.getTime() < 60_000) return res.status(429).json({ message: 'Wait one minute before requesting another code.' })
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await AccountOtp.findOneAndUpdate({ userId: req.user._id, purpose: 'email_change' }, { $set: { targetEmail: email, otpHash: hashAccountOtp(req.user._id, 'email_change', otp, email), expiresAt: new Date(Date.now() + 10 * 60_000), attempts: 0 } }, { upsert: true, new: true, setDefaultsOnInsert: true })
  try { await sendAccountOtp(email, otp, 'email_change') }
  catch (error) { await AccountOtp.deleteOne({ userId: req.user._id, purpose: 'email_change' }); console.error('New email verification failed:', error.message); return res.status(503).json({ message: 'Could not send a verification code to that email. Check the email settings and try again.' }) }
  res.json({ message: `A verification code was sent to ${email}.` })
})

router.put('/profile', async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Customer profile settings are only available to customer accounts.' })
  const nic = typeof req.body.nic === 'string' ? req.body.nic.trim().toUpperCase().replace(/\s+/g, '') : ''
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : ''
  if (!/^(?:\d{9}[VX]|\d{12})$/.test(nic)) return res.status(400).json({ message: 'Enter a valid NIC: 9 digits followed by V or X, or 12 digits.' })
  if (address.length < 6 || address.length > 300) return res.status(400).json({ message: 'Enter your default address, including town or nearby landmark.' })
  if (typeof req.body.password !== 'string' || !req.body.password) return res.status(400).json({ message: 'Enter your current password to save profile changes.' })
  await verifyAccountChange(req, 'profile_update')
  let addressLocation = null
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const response = await fetch(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?regionCode=LK`, { headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY } })
      const point = response.ok ? (await response.json()).results?.[0]?.location : null
      if (Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)) addressLocation = { latitude: point.latitude, longitude: point.longitude }
    } catch { /* Pickup requests can still use the saved text address. */ }
  }
  const update = { nic, defaultAddress: address }
  if (addressLocation) update.addressLocation = addressLocation
  else update.$unset = { addressLocation: 1 }
  const saved = await User.findByIdAndUpdate(req.user._id, addressLocation ? update : { $set: { nic, defaultAddress: address }, $unset: { addressLocation: 1 } }, { new: true }).select('nic defaultAddress addressLocation')
  recordAudit(req, { action: 'profile.updated', entityType: 'user', entityId: req.user._id, summary: 'Updated customer identity and delivery address details.' })
  res.json({ message: addressLocation ? 'NIC and default address saved.' : 'NIC and address saved. Google could not locate this address, so pickup is available but delivery routes need a valid mapped address.', nic: saved.nic, address: saved.defaultAddress, mapsConfigured: Boolean(addressLocation) })
})

router.put('/account/profile', async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Customer account settings are only available to customer accounts.' })
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : ''
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const nic = typeof req.body.nic === 'string' ? req.body.nic.trim().toUpperCase().replace(/\s+/g, '') : ''
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : ''
  if (username.length < 2 || username.length > 50) return res.status(400).json({ message: 'Name must be between 2 and 50 characters.' })
  if (phone.length < 7 || phone.length > 24 || !/^[+\d().\s-]+$/.test(phone)) return res.status(400).json({ message: 'Enter a valid contact phone number.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' })
  if (nic && !/^(?:\d{9}[VX]|\d{12})$/.test(nic)) return res.status(400).json({ message: 'Enter a valid NIC: 9 digits followed by V or X, or 12 digits.' })
  if (address.length < 6 || address.length > 300) return res.status(400).json({ message: 'Enter your default address, including town or nearby landmark.' })
  if (typeof req.body.password !== 'string' || !req.body.password) return res.status(400).json({ message: 'Enter your current password to save profile changes.' })
  const conflict = await User.findOne({ _id: { $ne: req.user._id }, $or: [{ username }, { email }] }).select('username email')
  if (conflict) return res.status(409).json({ message: conflict.email === email ? 'Another account already uses this email address.' : 'That name is already in use.' })
  await verifyAccountChange(req, 'profile_update')
  if (email !== req.user.email) {
    const newEmailOtp = typeof req.body.emailOtp === 'string' ? req.body.emailOtp.trim() : ''
    if (!/^\d{6}$/.test(newEmailOtp)) return res.status(400).json({ message: 'Verify your new email address with its six-digit code.' })
    await consumeAccountOtp(req.user._id, 'email_change', newEmailOtp, email)
  }
  let addressLocation = null
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const response = await fetch(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?regionCode=LK`, { headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY } })
      const point = response.ok ? (await response.json()).results?.[0]?.location : null
      if (Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)) addressLocation = { latitude: point.latitude, longitude: point.longitude }
    } catch { /* Pickup requests can still use the saved text address. */ }
  }
  const update = { username, phone, email, nic, defaultAddress: address }
  if (addressLocation) update.addressLocation = addressLocation
  else update.$unset = { addressLocation: 1 }
  try {
    const saved = await User.findByIdAndUpdate(req.user._id, addressLocation ? update : { $set: update, $unset: { addressLocation: 1 } }, { new: true, runValidators: true }).select('username email phone nic defaultAddress')
    recordAudit(req, { action: 'profile.updated', entityType: 'user', entityId: req.user._id, summary: 'Updated account, contact, identity, and default address details.' })
    res.json({ message: addressLocation ? 'Account details saved.' : 'Account details saved. Google could not locate this address, so pickup is available but delivery routes need a valid mapped address.', user: { username: saved.username, email: saved.email, phone: saved.phone }, nic: saved.nic, address: saved.defaultAddress, mapsConfigured: Boolean(addressLocation) })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That name or email address is already in use.' })
    throw error
  }
})

router.put('/account/password', async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Customer account settings are only available to customer accounts.' })
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : ''
  if (newPassword.length < 10 || newPassword.length > 128) return res.status(400).json({ message: 'Choose a password between 10 and 128 characters.' })
  await verifyAccountChange(req, 'password_change')
  const account = await User.findById(req.user._id)
  if (await bcrypt.compare(newPassword, account.password)) return res.status(400).json({ message: 'Choose a new password that differs from your current password.' })
  account.password = await bcrypt.hash(newPassword, 12)
  await account.save()
  recordAudit(req, { action: 'account.password.updated', entityType: 'user', entityId: req.user._id, summary: 'Changed account password.' })
  res.json({ message: 'Password changed successfully.' })
})

router.get('/identity/status', async (req, res) => {
  const account = await User.findById(req.user._id).select('identityStatus identitySubmittedAt identityReviewNote')
  res.json({ status: account.identityStatus, submittedAt: account.identitySubmittedAt || null, reviewNote: account.identityReviewNote || '' })
})

router.post('/identity/submit', async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Identity verification is available to customer accounts.' })
  if (req.user.identityStatus === 'pending' || req.user.identityStatus === 'approved') return res.status(409).json({ message: 'Your identity application is already under review or approved.' })
  const incoming = [req.body.front, req.body.back]
  const images = []
  for (const data of incoming) {
    const match = typeof data === 'string' && data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return res.status(400).json({ message: 'Upload clear JPEG, PNG, or WebP images of both sides of your ID.' })
    const buffer = Buffer.from(match[2], 'base64')
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return res.status(400).json({ message: 'Each identity image must be under 3 MB.' })
    images.push({ buffer, extension: imageTypes[match[1]] })
  }
  const paths = []
  try {
    await mkdir(identityUploadDir, { recursive: true })
    for (const image of images) {
      const filename = `${randomUUID()}.${image.extension}`
      await writeFile(path.join(identityUploadDir, filename), image.buffer, { flag: 'wx' })
      paths.push(filename)
    }
    await User.findByIdAndUpdate(req.user._id, { identityStatus: 'pending', identityFrontPath: paths[0], identityBackPath: paths[1], identitySubmittedAt: new Date(), identityReviewNote: '' })
    recordAudit(req, { action: 'identity.submitted', entityType: 'user', entityId: req.user._id, summary: 'Submitted identity documents for admin review.' })
    res.status(201).json({ message: 'Identity documents submitted for admin review.', status: 'pending' })
  } catch (error) {
    await Promise.all(paths.map((filename) => unlink(path.join(identityUploadDir, filename)).catch(() => {})))
    throw error
  }
})

router.put('/address', async (req, res) => {
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : ''
  if (address.length < 6 || address.length > 300) return res.status(400).json({ message: 'Enter a complete delivery address.' })
  if (!process.env.GOOGLE_MAPS_API_KEY) return res.status(503).json({ message: 'Address saved after enabling Google Maps: set GOOGLE_MAPS_API_KEY in server/.env with Geocoding API access.' })
  const response = await fetch(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?regionCode=LK`, { headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY } })
  if (!response.ok) return res.status(502).json({ message: 'Google could not look up that address. Check the address and Maps API setup.' })
  const point = (await response.json()).results?.[0]?.location
  if (!point) return res.status(400).json({ message: 'No location found for that address. Add a nearby town or landmark.' })
  const user = await User.findByIdAndUpdate(req.user._id, { defaultAddress: address, addressLocation: { latitude: point.latitude, longitude: point.longitude } }, { new: true }).select('defaultAddress addressLocation')
  res.json({ message: 'Default delivery address saved.', address: user.defaultAddress, addressLocation: user.addressLocation })
})

router.post('/delivery/quote', async (req, res) => {
  const ids = Array.isArray(req.body.productIds) ? [...new Set(req.body.productIds.map(String))] : []
  if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'Choose rental items before calculating delivery.' })
  if (!validPoint(req.user.addressLocation)) return res.status(400).json({ message: 'Save your default delivery address first.' })
  if (!process.env.GOOGLE_MAPS_API_KEY) return res.status(503).json({ message: 'Set GOOGLE_MAPS_API_KEY in server/.env and enable Geocoding and Routes APIs to calculate delivery.' })
  const products = await Product.find({ _id: { $in: ids }, active: true }).select('coordinates')
  if (products.length !== ids.length) return res.status(409).json({ message: 'A cart listing is no longer available.' })
  try {
    const routes = await routesForProducts(products, req.user.addressLocation)
    const distanceKm = routes.reduce((sum, route) => sum + route.distanceKm, 0)
    const deliveryFee = Math.round(Number(process.env.DELIVERY_BASE_FEE_LKR || 250) + distanceKm * Number(process.env.DELIVERY_PER_KM_LKR || 80))
    return res.json({ distanceKm, deliveryFee, etaMinutes: Math.max(...routes.map((route) => route.etaMinutes)), mapsConfigured: true })
  } catch (error) { return res.status(502).json({ message: error.message || 'Could not calculate a delivery route.' }) }
})

router.post('/coupons/validate', async (req, res) => {
  const subtotal = Number(req.body.subtotal)
  if (!Number.isFinite(subtotal) || subtotal < 0) return res.status(400).json({ message: 'The rental subtotal is not valid.' })
  try {
    const { coupon, discountAmount } = await priceCoupon(req.body.code, subtotal)
    if (!coupon) return res.status(400).json({ message: 'Enter a coupon code.' })
    res.json({ code: coupon.code, discountAmount, totalAfterDiscount: subtotal - discountAmount })
  } catch (error) { res.status(400).json({ message: error.message }) }
})

router.post('/requests', async (req, res) => {
  const { productIds, startDate: startValue, endDate: endValue, deliveryMethod, address } = req.body
  const billingUnit = req.body.billingUnit === 'hour' ? 'hour' : 'day'
  const start = new Date(startValue), end = new Date(endValue)
  const ids = Array.isArray(productIds) ? [...new Set(productIds.map(String))] : []
  if (!ids.length || ids.length > 30 || ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'Add at least one valid product to your cart.' })
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || start < new Date(new Date().setHours(0, 0, 0, 0))) return res.status(400).json({ message: 'Choose valid rental start and end dates.' })
  if (!['pickup', 'partner'].includes(deliveryMethod)) return res.status(400).json({ message: 'Choose pickup or delivery partner.' })
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Only customer accounts can request rentals.' })
  if (!/^(?:\d{9}[VX]|\d{12})$/.test(req.user.nic || '')) return res.status(400).json({ message: 'Save a valid NIC in your profile before requesting a rental.' })
  if (!req.user.defaultAddress || req.user.defaultAddress.trim().length < 6) return res.status(400).json({ message: 'Save your default address in your profile before requesting a rental.' })
  const products = await Product.find({ _id: { $in: ids }, active: true }).populate('providerId', 'email username role active shopStatus')
  if (products.length !== ids.length) return res.status(409).json({ message: 'One or more listings are no longer available.' })
  if (products.some((p) => p.providerId && (!p.providerId.active || (p.providerId.role === 'rental_shop' && p.providerId.shopStatus !== 'approved')))) return res.status(409).json({ message: 'A listing provider is not currently active.' })
  let deliveryAddress = ''
  let delivery = { distanceKm: 0, etaMinutes: 0 }
  if (deliveryMethod === 'partner') {
    deliveryAddress = req.user.defaultAddress || ''
    if (!deliveryAddress || !validPoint(req.user.addressLocation)) return res.status(400).json({ message: 'Save a default delivery address before choosing delivery.' })
    let routes
    try {
      routes = await routesForProducts(products, req.user.addressLocation)
    } catch (error) { return res.status(502).json({ message: error.message || 'Could not calculate a delivery route.' }) }
    delivery = { distanceKm: routes.reduce((sum, route) => sum + route.distanceKm, 0), etaMinutes: Math.max(...routes.map((route) => route.etaMinutes)) }
  }
  const dayCount = Math.ceil((end - start) / 86400000)
  const billableHours = Math.ceil((end - start) / 3600000)
  const priceForDays = (product) => {
    const daily = Number(product.dailyRate || 0)
    if (billingUnit === 'hour' && product.hourlyRate) return billableHours * Number(product.hourlyRate)
    const weekly = Number(product.weeklyRate || daily * 7)
    const weeks = Math.floor(dayCount / 7), remainingDays = dayCount % 7
    const base = dayCount >= 7 ? weeks * weekly + remainingDays * daily : dayCount * daily
    return Math.round(base * (1 - Number(product.longRentalDiscountPercent || 0) / 100))
  }
  const subtotal = products.reduce((sum, product) => sum + priceForDays(product), 0)
  let coupon = null, discountAmount = 0
  try { ({ coupon, discountAmount } = await priceCoupon(req.body.couponCode, subtotal)) }
  catch (error) { return res.status(400).json({ message: error.message }) }
  const deliveryFee = deliveryMethod === 'partner' ? Math.round(Number(process.env.DELIVERY_BASE_FEE_LKR || 250) + delivery.distanceKm * Number(process.env.DELIVERY_PER_KM_LKR || 80)) : 0
  const request = await RentalRequest.create({ customerId: req.user._id, items: products.map((product) => ({ productId: product._id, providerId: product.providerId?._id || product.createdBy, title: product.title, dailyRate: product.dailyRate, hourlyRate: product.hourlyRate, weeklyRate: product.weeklyRate, billingUnit, billableHours, rentalAmount: priceForDays(product), depositAmount: product.depositAmount || 0 })), startDate: start, endDate: end, deliveryMethod, address: deliveryAddress, distanceKm: delivery.distanceKm, etaMinutes: delivery.etaMinutes, deliveryFee, subtotal, couponCode: coupon?.code || '', discountAmount, total: subtotal - discountAmount + deliveryFee })
  for (const product of products) {
    const result = await Product.updateOne({ _id: product._id, active: true, rentalSlots: { $not: { $elemMatch: { startDate: { $lt: end }, endDate: { $gt: start }, status: { $in: ['pending', 'accepted'] } } } } }, { $push: { rentalSlots: { requestId: request._id, startDate: start, endDate: end, status: 'pending' } } })
    if (!result.modifiedCount) {
      await Product.updateMany({ 'rentalSlots.requestId': request._id }, { $pull: { rentalSlots: { requestId: request._id } } })
      await RentalRequest.findByIdAndDelete(request._id)
      return res.status(409).json({ message: `${product.title} was just booked for those dates. Refresh availability and try again.` })
    }
  }
  if (coupon) {
    const couponFilter = { _id: coupon._id, active: true }
    if (coupon.maxRedemptions) couponFilter.redemptionCount = { $lt: coupon.maxRedemptions }
    const redeemed = await Coupon.updateOne(couponFilter, { $inc: { redemptionCount: 1 } })
    if (!redeemed.modifiedCount) {
      await Product.updateMany({ 'rentalSlots.requestId': request._id }, { $pull: { rentalSlots: { requestId: request._id } } })
      await RentalRequest.findByIdAndDelete(request._id)
      return res.status(409).json({ message: 'This coupon was just fully redeemed. Remove it and try again.' })
    }
  }
  const providerIds = [...new Set(request.items.map((item) => String(item.providerId)))]
  const providers = await User.find({ _id: { $in: providerIds } }).select('email username role shopName phone')
  await Promise.all(providers.map((provider) => notify(provider, request._id, 'New rental request', `${req.user.username} requested ${request.items.filter((item) => String(item.providerId) === String(provider._id)).map((item) => item.title).join(', ')}. Please review and accept or reject the request.`)))
  recordAudit(req, { action: 'booking.created', entityType: 'rental_request', entityId: request._id, summary: `Submitted a rental request with ${request.items.length} item(s).` })
  res.status(201).json({ message: 'Rental request sent to the provider. You will see their decision in your mailbox.', request: publicRequest(request) })
})

router.get('/requests', async (req, res) => {
  const requests = await RentalRequest.find({ customerId: req.user._id }).populate('items.assignedPartner', 'username phone').sort({ createdAt: -1 }).limit(100).lean()
  res.json({ requests })
})

router.get('/provider/requests', async (req, res) => {
  if (!['rental_shop', 'admin'].includes(req.user.role)) return res.status(403).json({ message: 'Provider access is required.' })
  const requests = await RentalRequest.find({ 'items.providerId': req.user._id }).populate('customerId', 'username email phone').sort({ createdAt: -1 }).limit(100).lean()
  for (const request of requests) request.items = request.items.filter((item) => String(item.providerId) === String(req.user._id))
  res.json({ requests })
})

router.get('/owner/products', async (req, res) => {
  if (req.user.role !== 'rental_shop') return res.status(403).json({ message: 'Rental shop access is required.' })
  const products = await Product.find({ $or: [{ providerId: req.user._id }, { createdBy: req.user._id }] }).sort({ createdAt: -1 }).lean()
  res.json({ products })
})

router.post('/owner/products', async (req, res) => {
  if (req.user.role !== 'rental_shop') return res.status(403).json({ message: 'Rental shop access is required.' })
  const { title, category, description } = req.body
  const dailyRate = Number(req.body.dailyRate)
  const depositAmount = Number(req.body.depositAmount || 0)
  const optionalRate = (value) => value === undefined || value === '' ? undefined : Number(value)
  const hourlyRate = optionalRate(req.body.hourlyRate)
  const weeklyRate = optionalRate(req.body.weeklyRate)
  const longRentalDiscountPercent = Number(req.body.longRentalDiscountPercent || 0)
  const photos = Array.isArray(req.body.photos) ? req.body.photos : []
  if (![title, category, description].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Product name, category, and description are required.' })
  if (!Number.isFinite(dailyRate) || dailyRate < 0 || !Number.isFinite(depositAmount) || depositAmount < 0) return res.status(400).json({ message: 'Enter valid rental and deposit amounts.' })
  if ([hourlyRate, weeklyRate].some((rate) => rate !== undefined && (!Number.isFinite(rate) || rate < 0)) || !Number.isFinite(longRentalDiscountPercent) || longRentalDiscountPercent < 0 || longRentalDiscountPercent > 90) return res.status(400).json({ message: 'Enter valid hourly, weekly, and long-rental discount prices.' })
  if (photos.length < 1 || photos.length > 6) return res.status(400).json({ message: 'Add between 1 and 6 product photos.' })
  const savedPaths = []
  try {
    const images = photos.map((photo) => {
      const match = typeof photo === 'string' && photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
      if (!match || !imageTypes[match[1]]) throw new Error('Use JPEG, PNG, or WebP product photos.')
      const buffer = Buffer.from(match[2], 'base64')
      if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('Each photo must be smaller than 3 MB.')
      return { buffer, extension: imageTypes[match[1]] }
    })
    await mkdir(ownerUploadDir, { recursive: true })
    for (const image of images) {
      const filename = `${randomUUID()}.${image.extension}`
      await writeFile(path.join(ownerUploadDir, filename), image.buffer, { flag: 'wx' })
      savedPaths.push(`/uploads/products/${filename}`)
    }
    const specifications = Array.isArray(req.body.specifications) ? req.body.specifications.slice(0, 20).map((row) => ({ name: String(row.name || '').trim(), value: String(row.value || '').trim() })).filter((row) => row.name && row.value) : []
    const product = await Product.create({ title: title.trim(), category: category.trim(), description: description.trim(), dailyRate, hourlyRate, weeklyRate, longRentalDiscountPercent, depositAmount, specifications, photos: savedPaths, location: 'Batticaloa', createdBy: req.user._id, providerId: req.user._id })
    recordAudit(req, { action: 'product.created', entityType: 'product', entityId: product._id, summary: `Created rental listing ${product.title}.` })
    return res.status(201).json({ message: 'Rental listing published.', product })
  } catch (error) {
    await Promise.all(savedPaths.map((file) => unlink(path.join(ownerUploadDir, path.basename(file))).catch(() => {})))
    const isInputError = error.message.startsWith('Use JPEG') || error.message.startsWith('Each photo')
    return res.status(isInputError ? 400 : 500).json({ message: isInputError ? error.message : 'Could not publish this listing.' })
  }
})

router.patch('/owner/products/:id', async (req, res) => {
  if (req.user.role !== 'rental_shop') return res.status(403).json({ message: 'Rental shop access is required.' })
  const product = await Product.findOne({ _id: req.params.id, $or: [{ providerId: req.user._id }, { createdBy: req.user._id }] })
  if (!product) return res.status(404).json({ message: 'Your listing was not found.' })
  const updates = {}
  for (const field of ['title', 'category', 'description']) {
    if (req.body[field] !== undefined) {
      if (typeof req.body[field] !== 'string' || !req.body[field].trim()) return res.status(400).json({ message: `${field} cannot be empty.` })
      updates[field] = req.body[field].trim()
    }
  }
  for (const field of ['dailyRate', 'depositAmount', 'hourlyRate', 'weeklyRate', 'longRentalDiscountPercent']) {
    if (req.body[field] !== undefined) {
      if ((field === 'hourlyRate' || field === 'weeklyRate') && req.body[field] === '') { updates[field] = undefined; continue }
      const amount = Number(req.body[field])
      if (!Number.isFinite(amount) || amount < 0 || (field === 'longRentalDiscountPercent' && amount > 90)) return res.status(400).json({ message: `Enter a valid ${field === 'dailyRate' ? 'daily rate' : field === 'depositAmount' ? 'deposit amount' : field === 'longRentalDiscountPercent' ? 'discount from 0 to 90' : 'rental rate'}.` })
      updates[field] = amount
    }
  }
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'Listing status must be active or inactive.' })
    updates.active = req.body.active
  }
  Object.assign(product, updates)
  await product.save()
  recordAudit(req, { action: 'product.updated', entityType: 'product', entityId: product._id, summary: `Updated rental listing ${product.title}.` })
  res.json({ message: 'Listing updated.', product })
})

router.get('/delivery/assignments', async (req, res) => {
  if (req.user.role !== 'delivery_partner') return res.status(403).json({ message: 'Delivery partner access is required.' })
  const requests = await RentalRequest.find({ 'items.assignedPartner': req.user._id }).populate('customerId', 'username phone').sort({ createdAt: -1 }).limit(100).lean()
  for (const request of requests) request.items = request.items.filter((item) => String(item.assignedPartner) === String(req.user._id))
  res.json({ requests })
})

router.patch('/delivery/assignments/:requestId/items/:productId/status', async (req, res) => {
  if (req.user.role !== 'delivery_partner') return res.status(403).json({ message: 'Delivery partner access is required.' })
  const allowed = ['assigned', 'on_the_way', 'delivered', 'return_pickup', 'returning', 'returned']
  const status = req.body.status
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Choose a valid delivery status.' })
  const request = await RentalRequest.findOne({ _id: req.params.requestId, items: { $elemMatch: { productId: req.params.productId, assignedPartner: req.user._id } } })
  if (!request) return res.status(404).json({ message: 'Delivery assignment not found.' })
  const item = request.items.find((entry) => String(entry.productId) === req.params.productId && String(entry.assignedPartner) === String(req.user._id))
  const transitions = { assigned: ['on_the_way'], on_the_way: ['delivered'], delivered: ['return_pickup'], return_pickup: ['returning'], returning: ['returned'], returned: [] }
  if (!transitions[item.deliveryStatus || 'assigned']?.includes(status)) return res.status(409).json({ message: 'Update the delivery in order: assigned, on the way, delivered, return pickup, returning, returned.' })
  item.deliveryStatus = status
  await request.save()
  recordAudit(req, { action: `delivery.${status}`, entityType: 'rental_request', entityId: request._id, summary: `Updated delivery status for ${item.title} to ${status}.` })
  const customer = await User.findById(request.customerId).select('email username phone')
  const labels = { on_the_way: 'on the way', delivered: 'delivered', return_pickup: 'return pickup scheduled', returning: 'return in progress', returned: 'return completed' }
  const pointsAwarded = status === 'returned' ? Math.max(1, Math.floor(Number(item.rentalAmount || 0) / 1000)) : 0
  if (pointsAwarded) await User.updateOne({ _id: request.customerId }, { $inc: { loyaltyPoints: pointsAwarded } })
  await notify(customer, request._id, 'Delivery update', `${item.title}: ${labels[status]}.${pointsAwarded ? ` You earned ${pointsAwarded} RentEase loyalty point(s).` : ''}`)
  res.json({ message: `Delivery status updated: ${labels[status]}.`, request })
})

router.patch('/provider/requests/:requestId/items/:productId', async (req, res) => {
  if (!['rental_shop', 'admin'].includes(req.user.role)) return res.status(403).json({ message: 'Provider access is required.' })
  const { decision } = req.body
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Choose accept or reject.' })
  const request = await RentalRequest.findOne({ _id: req.params.requestId, 'items.productId': req.params.productId, 'items.providerId': req.user._id })
  if (!request) return res.status(404).json({ message: 'Rental request not found for this provider.' })
  const item = request.items.find((entry) => String(entry.productId) === req.params.productId)
  if (item.decision !== 'pending') return res.status(409).json({ message: 'This request already has a decision.' })
  item.decision = decision
  let assigned = null
  if (decision === 'accepted' && request.deliveryMethod === 'partner') {
    const candidates = await User.find({ role: 'delivery_partner', active: true }).select('_id')
    if (!candidates.length) { item.decision = 'pending'; return res.status(409).json({ message: 'No active delivery partners are available yet. Add a delivery partner, then retry.' }) }
    const counts = await RentalRequest.aggregate([{ $unwind: '$items' }, { $match: { 'items.assignedPartner': { $in: candidates.map((candidate) => candidate._id) }, 'items.decision': 'accepted' } }, { $group: { _id: '$items.assignedPartner', count: { $sum: 1 } } }])
    const loads = new Map(counts.map((row) => [String(row._id), row.count]))
    assigned = candidates.sort((a, b) => (loads.get(String(a._id)) || 0) - (loads.get(String(b._id)) || 0))[0]
    item.assignedPartner = assigned._id
  }
  await request.save()
  recordAudit(req, { action: `booking.${decision}`, entityType: 'rental_request', entityId: request._id, summary: `${decision === 'accepted' ? 'Accepted' : 'Declined'} booking item ${item.title}.` })
  await Product.updateOne({ _id: item.productId, 'rentalSlots.requestId': request._id }, { $set: { 'rentalSlots.$.status': decision === 'accepted' ? 'accepted' : 'pending' } })
  if (decision === 'rejected') await Product.updateOne({ _id: item.productId }, { $pull: { rentalSlots: { requestId: request._id } } })
  const customer = await User.findById(request.customerId).select('email username phone')
  const statusText = decision === 'accepted' ? 'accepted' : 'rejected'
  await notify(customer, request._id, `Rental ${statusText}`, `${req.user.shopName || req.user.username} ${statusText} your request for ${item.title}.${assigned ? ` A delivery partner has been assigned. Estimated route: ${request.etaMinutes} minutes.` : ''}`)
  if (assigned) {
    const partner = await User.findById(assigned._id).select('email username phone')
    await notify(partner, request._id, 'Delivery assigned', `A delivery for ${item.title} has been assigned to you. Destination: ${request.address || 'See the request details.'}`)
  }
  res.json({ message: `Request ${statusText}${assigned ? ' and delivery partner assigned' : ''}.`, request })
})

router.get('/inbox', async (req, res) => {
  const notifications = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean()
  res.json({ notifications })
})
router.patch('/inbox/read', async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, readAt: null }, { $set: { readAt: new Date() } })
  res.json({ message: 'Mailbox marked as read.' })
})

function haversine(a, b) {
  const rad = (value) => value * Math.PI / 180
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude)
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export default router
