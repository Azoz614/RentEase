import { Router } from 'express'
import mongoose from 'mongoose'
import { requireUser } from '../../middleware/auth.mjs'
import { RentalRequest } from './rental.model.mjs'
import { Product } from '../products/product.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { currentNotificationFilter } from '../notifications/handover-notifications.service.mjs'
import {
  initiateVerification,
  verifyHandover,
  maskEmail,
  pickupWorkflow,
  returnWorkflow,
  activeVerificationChallenge,
  confirmPickupHandover,
  preparePickup,
  confirmReturnReceipt,
  completeRental,
} from './handover.service.mjs'

const fields =
  'customerId items startDate endDate status statusHistory createdAt updatedAt total deliveryMethod deliveryWorkflowVersion returnMethod shipments deliveryDestination address selfReturns.providerId selfReturns.status selfReturns.verifiedAt selfReturns.initiatedBy selfReturns.recipientId selfReturns.verifiedBy pickupVerifiedAt pickupCustomerVerifiedAt readyForPickupAt requiresPickupPreparation requiresReturnConfirmation returnOtpVerifiedAt returnInspection pickupVerifiedBy returnVerifiedAt returnVerifiedBy cancelledAt cancellationReason handover.pickup.status handover.pickup.sentAt handover.pickup.expiresAt handover.return.status handover.return.sentAt handover.return.expiresAt payment.status payment.depositHeld payment.depositRefunded payment.refundedAt payment.adjustments.type payment.adjustments.amount payment.adjustments.note payment.adjustments.createdAt'
const statusLabels = { confirmed: 'BOOKED', active: 'ON_RENTAL', returned: 'RETURNED' }
// Shops only ever load bookings that contain one of their items.
const scoped = (id, actor) => ({ _id: id, ...(actor.role === 'rental_shop' && { 'items.providerId': actor._id }) })
const serialize = ({ handover, ...rental }, actor) => {
  const items = actor.role === 'rental_shop' ? rental.items.filter((i) => String(i.providerId) === String(actor._id)) : rental.items
  // In a booking shared with other shops, a shop sees its own share, not the whole total.
  const shared = items.length < rental.items.length
  return {
    ...rental,
    items,
    // Deposits are settled for the whole booking, so a shop sharing it only sees the payment status.
    ...(shared && { total: items.reduce((sum, i) => sum + Number(i.rentalAmount || 0), 0), shared: true,
      payment: rental.payment && { status: rental.payment.status } }),
    pickupCompleted: items.length > 0 && items.every((i) => i.pickupVerifiedAt),
    readyForPickupAt: rental.readyForPickupAt || (items.length && items.every((i) => i.pickupReadyAt) ? items[0].pickupReadyAt : null),
    shipments: rental.shipments?.filter((s) => actor.role === 'admin' || String(s.providerId) === String(actor._id)),
    pickupVerification: pickupWorkflow({ ...rental, handover }),
    returnVerification: returnWorkflow({ ...rental, handover }),
    lifecycleStatus: statusLabels[rental.status] || String(rental.status || 'pending').toUpperCase(),
    customerId: rental.customerId
      ? {
          _id: rental.customerId._id,
          username: rental.customerId.username,
          phone: rental.customerId.phone,
          maskedEmail: rental.customerId.email ? maskEmail(rental.customerId.email) : '',
        }
      : null,
  }
}
const populate = (query) =>
  query
    .populate('customerId', 'username email phone')
    .populate('pickupVerifiedBy returnVerifiedBy statusHistory.by statusHistory.senderId statusHistory.recipientId', 'username')
const idCheck = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ message: 'Choose a valid rental.' })

export function createRentalVerificationRouter(dependencies = {}) {
  const router = Router()
  router.use(requireUser, (req, res, next) =>
    ['admin', 'rental_shop'].includes(req.user.role)
      ? next()
      : res.status(403).json({ message: 'Rental staff access is required.' }),
  )
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.use('/rentals/:id', idCheck, async (req, res, next) => {
    if (req.user.role === 'rental_shop') {
      const rental = await RentalRequest.findById(req.params.id).select('items.providerId').lean()
      if (!rental || !rental.items.some((i) => String(i.providerId) === String(req.user._id)))
        return res.status(404).json({ message: 'Rental not found for this shop.' })
    }
    next()
  })
  router.get('/rentals', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
    const status = typeof req.query.status === 'string' ? req.query.status : ''
    if (
      status &&
      ![
        'pending',
        'confirmed',
        'active',
        'return_in_transit',
        'returned',
        'completed',
        'cancelled',
        'disputed',
      ].includes(status)
    )
      return res.status(400).json({ message: 'Choose a valid rental status.' })
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
    const staffScope = {
      ...(req.user.role === 'rental_shop'
        ? { 'items.providerId': req.user._id }
        : {}),
    }
    const filter = { ...staffScope, ...(status ? { status } : {}) }
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      // Customer lookup is bounded to the matching accounts; rental result pages are capped.
      const { User } = await import('../users/user.model.mjs')
      const customers = await User.find({ $or: [{ username: regex }, { email: regex }] })
        .select('_id')
        .limit(500)
        .lean()
      filter.$or = [
        { 'items.title': regex },
        { customerId: { $in: customers.map((user) => user._id) } },
      ]
      if (mongoose.isValidObjectId(q)) filter.$or.push({ _id: q })
    }
    const [rentals, total, grouped] = await Promise.all([
      populate(
        RentalRequest.find(filter)
          .select(fields)
          .sort({ createdAt: -1 })
          .skip((page - 1) * 20)
          .limit(20),
      ).lean(),
      RentalRequest.countDocuments(filter),
      RentalRequest.aggregate([
        { $match: staffScope },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ])
    const counts = grouped.reduce((result, row) => {
      const key = row._id || 'pending'
      result[key] = (result[key] || 0) + row.count
      return result
    }, {})
    res.json({
      rentals: rentals.map((r) => serialize(r, req.user)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / 20)),
      stats: {
        total: grouped.reduce((sum, row) => sum + row.count, 0),
        awaitingPickup: counts.confirmed || 0,
        onRental: counts.active || 0,
        returned: (counts.returned || 0) + (counts.completed || 0),
      },
    })
  })
  router.get('/rentals/:id', idCheck, async (req, res) => {
    const rental = await populate(RentalRequest.findOne(scoped(req.params.id, req.user)).select(fields)).lean()
    if (!rental) return res.status(404).json({ message: 'Rental not found.' })
    const products = await Product.find({ _id: { $in: rental.items.map((i) => i.productId) } }).select('photos category').lean()
    const notifications = await Notification.find({ requestId: rental._id, userId: req.user._id, ...currentNotificationFilter() })
      .select('title body createdAt expiresAt').sort({ createdAt: -1 }).limit(30).lean()
    const view = serialize(rental, req.user)
    res.json({ rental: { ...view, notifications,
      items: view.items.map((item) => ({ ...item, image: products.find((p) => String(p._id) === String(item.productId))?.photos?.[0] || null })) } })
  })
  router.get('/rentals/:id/history', idCheck, async (req, res) => {
    const rental = await RentalRequest.findOne(scoped(req.params.id, req.user))
      .select('statusHistory items.providerId')
      .populate('statusHistory.by', 'username')
      .lean()
    if (!rental) return res.status(404).json({ message: 'Rental not found.' })
    // Other shops' item decisions (and their reasons) stay private in a shared booking.
    const mine = (entry) => String(entry.by?._id || entry.by) === String(req.user._id)
    const history = (rental.statusHistory || []).filter((entry) =>
      req.user.role === 'admin' || !String(entry.action || '').startsWith('booking.item.') || mine(entry))
    res.json({ history })
  })
  router.post('/rentals/:id/verification/:type/send', idCheck, async (req, res) => {
    res.json(
      await initiateVerification({
        rentalId: req.params.id,
        type: req.params.type,
        actor: req.user,
        ...dependencies,
      }),
    )
  })
  router.get('/rentals/:id/verification/:type', idCheck, async (req, res) => {
    res.json(
      await activeVerificationChallenge({
        rentalId: req.params.id,
        type: req.params.type,
        actor: req.user,
      }),
    )
  })
  router.post('/rentals/:id/handover/confirm', idCheck, async (req, res) => {
    const result = await confirmPickupHandover({
      rentalId: req.params.id,
      actor: req.user,
      ipAddress: req.ip,
    })
    res.json({
      message: result.message,
      rental: {
        _id: result.rental._id,
        status: result.rental.status,
        pickupVerifiedAt: result.rental.pickupVerifiedAt,
        updatedAt: result.rental.updatedAt,
      },
    })
  })
  router.post('/rentals/:id/ready', idCheck, async (req, res) =>
    res.json(await preparePickup({ rentalId: req.params.id, actor: req.user })),
  )
  router.post('/rentals/:id/complete', idCheck, async (req, res) =>
    res.json(await completeRental({ rentalId: req.params.id, actor: req.user })),
  )
  router.post('/rentals/:id/return/confirm', idCheck, async (req, res) => {
    const result = await confirmReturnReceipt({
      rentalId: req.params.id,
      actor: req.user,
      inspectionNote: req.body?.inspectionNote,
    })
    res.json({
      message: result.message,
      rental: {
        _id: result.rental._id,
        status: result.rental.status,
        returnVerifiedAt: result.rental.returnVerifiedAt,
        updatedAt: result.rental.updatedAt,
      },
    })
  })
  router.post('/rentals/:id/verification/:type/verify', idCheck, async (req, res) => {
    const result = await verifyHandover({
      rentalId: req.params.id,
      type: req.params.type,
      actor: req.user,
      code: req.body?.code,
      challengeId: req.body?.challengeId,
      ipAddress: req.ip,
    })
    res.json({
      message: result.message,
      rental: {
        _id: result.rental._id,
        status: result.rental.status,
        pickupVerifiedAt: result.rental.pickupVerifiedAt,
        returnVerifiedAt: result.rental.returnVerifiedAt,
      },
    })
  })
  router.use((error, _req, res, _next) => {
    const status = error.status || 500
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
    if (!error.status) console.error('Rental verification failed:', error.name)
    res.status(status).json({
      code: error.code && typeof error.code === 'string' ? error.code : 'VERIFICATION_FAILED',
      message: error.status
        ? error.message
        : 'Could not complete rental verification. Refresh and try again.',
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    })
  })
  return router
}

export default createRentalVerificationRouter()
