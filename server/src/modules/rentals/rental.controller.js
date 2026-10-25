import mongoose from 'mongoose'
import { Product } from '../products/product.model.mjs'
import { RentalRequest } from './rental.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { User } from '../users/user.model.mjs'
import { recordAudit } from '../../services/audit.service.js'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { Coupon } from '../payments/coupon.model.mjs'
import { customerRentalFields, customerRentalViews } from './customer-rentals.service.mjs'
import { cancelRental } from './cancellation.service.mjs'
import { verificationError } from '../../middleware/workflow-error.mjs'
import { inventoryAvailability } from '../products/availability.service.mjs'
import { decideRentalItem } from './decision.service.mjs'
import { assertRentalEligible } from '../identity/identity.service.mjs'
import { identityError, identityRate } from '../identity/identity-security.service.mjs'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { providerRentalRequests } from './provider-rentals.service.mjs'
import { rentalAmount } from './rental-pricing.service.mjs'
import {
  calculateDelivery,
  deliveryDestination,
  validateQuote,
  verifyQuoteToken,
} from '../delivery/delivery-quote.service.mjs'
import { DeliveryLocation } from '../delivery/delivery-location.model.mjs'

import { notify } from '../notifications/rental-notifications.service.mjs'
import { priceCoupon } from '../payments/coupon.service.mjs'
import { publicRequest, canManageRequest, changeStatus } from './rental-workflow.service.mjs'

export const createRental = async (req, res) => {
  const { productIds, startDate: startValue, endDate: endValue, deliveryMethod } = req.body
  const billingUnit = req.body.billingUnit === 'hour' ? 'hour' : 'day'
  const start = new Date(startValue),
    end = new Date(endValue)
  const ids = Array.isArray(productIds) ? [...new Set(productIds.map(String))] : []
  if (!ids.length || ids.length > 30 || ids.some((id) => !mongoose.isValidObjectId(id)))
    return res.status(400).json({ message: 'Add at least one valid product to your cart.' })
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    start < new Date(new Date().setHours(0, 0, 0, 0))
  )
    return res.status(400).json({ message: 'Choose valid rental start and end dates.' })
  if (!['pickup', 'partner'].includes(deliveryMethod))
    return res.status(400).json({ message: 'Choose pickup or delivery partner.' })
  if (req.user.role !== 'user')
    return res.status(403).json({ message: 'Only customer accounts can request rentals.' })
  let eligibility
  try {
    eligibility = await assertRentalEligible(req.user._id)
  } catch (error) {
    return verificationError(error, req, res, () => {})
  }
  const accountVersion = eligibility.user.__v
  const products = await Product.find({ _id: { $in: ids }, active: true }).populate(
    'providerId',
    'email username role active shopStatus',
  )
  if (products.length !== ids.length)
    return res.status(409).json({ message: 'One or more listings are no longer available.' })
  if (
    products.some(
      (p) =>
        p.providerId &&
        (!p.providerId.active ||
          (p.providerId.role === 'rental_shop' && p.providerId.shopStatus !== 'approved')),
    )
  )
    return res.status(409).json({ message: 'A listing provider is not currently active.' })
  const availability = await inventoryAvailability(products, start, end)
  const unavailable = products.find((product) => !availability.get(String(product._id)).available)
  if (unavailable)
    return res.status(409).json({
      message:
        availability.get(String(unavailable._id)).state === 'on_rental'
          ? `${unavailable.title} is currently on rental. It can be requested again after its return is confirmed.`
          : `${unavailable.title} is already booked for these dates. Choose different dates.`,
    })
  let deliveryAddress = ''
  let delivery = {
    distanceKm: 0,
    etaMinutes: 0,
    deliveryFee: 0,
    returnCollectionFee: 0,
    shipments: [],
  }
  if (deliveryMethod === 'partner') {
    try {
      await identityRate(req.user._id, 'delivery-confirm', 20)
      verifyQuoteToken(req.body.quoteToken, req.user)
      const destination = deliveryDestination(eligibility.user, req.body)
      delivery = await calculateDelivery(products, destination)
      validateQuote(req.body.quoteToken, req.user, products, destination, delivery)
      deliveryAddress = destination.address
    } catch (error) {
      return res
        .status(error.status || 502)
        .json({ message: error.message || 'Could not calculate a delivery route.' })
    }
  }
  const dayCount = Math.ceil((end - start) / 86400000)
  const billableHours = Math.ceil((end - start) / 3600000)
  const priceForDays = (product) => rentalAmount(product, { dayCount, billableHours, billingUnit })
  const subtotal = products.reduce((sum, product) => sum + priceForDays(product), 0)
  let coupon = null,
    discountAmount = 0
  try {
    ;({ coupon, discountAmount } = await priceCoupon(req.body.couponCode, subtotal))
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
  const deliveryFee = Math.round((delivery.deliveryFee + delivery.returnCollectionFee) * 100) / 100
  if (
    req.body.expectedTotal !== undefined &&
    (!Number.isFinite(req.body.expectedTotal) ||
      Math.round(req.body.expectedTotal * 100) !==
        Math.round((subtotal - discountAmount + deliveryFee) * 100))
  )
    return res.status(409).json({
      message: 'Rental prices changed. Refresh your cart and review the total before booking.',
    })
  let request
  try {
    await requireTransactions()
    await mongoose.connection.transaction(async (session) => {
      eligibility = await assertRentalEligible(req.user._id, session)
      if (eligibility.user.__v !== accountVersion)
        throw identityError(
          409,
          'ELIGIBILITY_CHANGED',
          'Your profile or default address changed. Review your booking and try again.',
        )
      const locked = await User.updateOne(
        { _id: req.user._id, __v: eligibility.user.__v },
        { $inc: { __v: 1 } },
        { session },
      )
      if (!locked.modifiedCount)
        throw identityError(
          409,
          'ELIGIBILITY_CHANGED',
          'Your profile changed. Review your verification and try again.',
        )
      request = (
        await RentalRequest.create(
          [
            {
              customerId: req.user._id,
              items: products.map((product) => ({
                productId: product._id,
                providerId: product.providerId?._id || product.createdBy,
                title: product.title,
                dailyRate: product.dailyRate,
                hourlyRate: product.hourlyRate,
                weeklyRate: product.weeklyRate,
                billingUnit,
                billableHours,
                rentalAmount: priceForDays(product),
                depositAmount: product.depositAmount || 0,
              })),
              startDate: start,
              endDate: end,
              durationHours: billableHours,
              deliveryMethod,
              ...(deliveryMethod === 'partner' ? { deliveryWorkflowVersion: 2 } : {}),
              address: deliveryAddress || eligibility.user.defaultAddress,
              addressSnapshot: eligibility.address,
              deliveryDestination: delivery.destination,
              shipments: delivery.shipments,
              returnCollectionFee: delivery.returnCollectionFee,
              identityVerificationId: eligibility.identity._id,
              requiresPickupPreparation: true,
              requiresReturnConfirmation: true,
              distanceKm: delivery.distanceKm,
              etaMinutes: delivery.etaMinutes,
              deliveryDurationSeconds: delivery.durationSeconds,
              deliveryQuotedAt: delivery.quotedAt,
              estimatedArrivalAt: delivery.estimatedArrivalAt,
              deliveryFee,
              subtotal,
              couponCode: coupon?.code || '',
              discountAmount,
              total: Math.round((subtotal - discountAmount + deliveryFee) * 100) / 100,
              status: 'pending',
              statusHistory: [
                { status: 'pending', by: req.user._id, note: 'Booking request submitted.' },
              ],
            },
          ],
          { session },
        )
      )[0]
      for (const product of products) {
        const result = await Product.updateOne(
          {
            _id: product._id,
            active: true,
            __v: product.__v ?? { $exists: false },
            rentalSlots: {
              $not: {
                $elemMatch: {
                  requestId: { $nin: availability.get(String(product._id)).ignoredRequestIds },
                  startDate: { $lt: end },
                  endDate: { $gt: start },
                  status: { $in: ['pending', 'accepted'] },
                },
              },
            },
          },
          {
            $push: {
              rentalSlots: {
                requestId: request._id,
                startDate: start,
                endDate: end,
                status: 'pending',
              },
            },
            $inc: { __v: 1 },
          },
          { session },
        )
        if (!result.modifiedCount)
          throw identityError(
            409,
            'ITEM_UNAVAILABLE',
            product.title + ' was just booked or its availability changed. Refresh and try again.',
          )
      }
      if (coupon) {
        const filter = {
          _id: coupon._id,
          active: true,
          ...(coupon.maxRedemptions ? { redemptionCount: { $lt: coupon.maxRedemptions } } : {}),
        }
        if (
          !(await Coupon.updateOne(filter, { $inc: { redemptionCount: 1 } }, { session }))
            .modifiedCount
        )
          throw identityError(
            409,
            'COUPON_UNAVAILABLE',
            'This coupon is no longer available. Remove it and try again.',
          )
      }
      const providerIds = [...new Set(request.items.map((item) => String(item.providerId)))]
      const admins = await User.find({ role: 'admin', active: true }).select('_id').session(session)
      const recipients = new Set([...providerIds, ...admins.map((admin) => String(admin._id))])
      for (const userId of recipients)
        await Notification.create(
          [
            {
              userId,
              requestId: request._id,
              title: 'New rental request',
              body: `${req.user.username} submitted a rental request. Review its items before accepting or rejecting.`,
              link: 'requests',
            },
          ],
          { session },
        )
      await Notification.create(
        [
          {
            userId: req.user._id,
            requestId: request._id,
            title: 'Rental request submitted',
            body: 'Your request is awaiting provider approval.',
            link: 'requests',
          },
        ],
        { session },
      )
      await AuditLog.create(
        [
          {
            actorId: req.user._id,
            actorRole: req.user.role,
            action: 'booking.created',
            entityType: 'rental_request',
            entityId: String(request._id),
            summary: `Submitted a rental request with ${request.items.length} item(s).`,
            ipAddress: req.ip,
          },
        ],
        { session },
      )
    })
  } catch (error) {
    return verificationError(error, req, res, () => {})
  }
  const providerIds = [...new Set(request.items.map((item) => String(item.providerId)))]
  const providers = await User.find({ _id: { $in: providerIds } }).select(
    'email username role shopName phone',
  )
  await Promise.all(
    providers.map((provider) =>
      notify(
        provider,
        request._id,
        'New rental request',
        `${req.user.username} requested ${request.items
          .filter((item) => String(item.providerId) === String(provider._id))
          .map((item) => item.title)
          .join(', ')}. Please review and accept or reject the request.`,
        false,
      ),
    ),
  )
  res.status(201).json({
    message: 'Rental request sent to the provider. You will see their decision in your mailbox.',
    request: publicRequest(request),
  })
}

export const listCustomerRentals = async (req, res) => {
  const rentals = await RentalRequest.find({ customerId: req.user._id })
    .select(customerRentalFields)
    .sort({ createdAt: -1 })
    .lean()
  res.set('Cache-Control', 'private, no-store')
  res.json({ requests: await customerRentalViews(rentals) })
}

export const getCustomerRental = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.requestId))
    return res.status(400).json({ message: 'Choose a valid rental booking.' })
  const rental = await RentalRequest.findOne({
    _id: req.params.requestId,
    customerId: req.user._id,
  })
    .select(customerRentalFields)
    .lean()
  res.set('Cache-Control', 'private, no-store')
  if (!rental) return res.status(404).json({ message: 'This rental booking is not available.' })
  const [view] = await customerRentalViews([rental], { details: true })
  res.json({ rental: view })
}

export const cancelCustomerRental = async (req, res, next) => {
  try {
    const request = await cancelRental({
      rentalId: req.params.requestId,
      actor: req.user,
      reason: req.body?.reason,
      ipAddress: req.ip,
    })
    const [view] = await customerRentalViews([request])
    res.set('Cache-Control', 'private, no-store').json({
      message:
        'Booking cancelled. Any sandbox deposit hold has been released; no real-money refund was processed.',
      request: view,
    })
  } catch (error) {
    verificationError(error, req, res, next)
  }
}

export const listProviderRentals = async (req, res) => {
  const requests = await providerRentalRequests(req.user)
  res.set('Cache-Control', 'private, no-store')
  res.json({ requests })
}

export const decideProviderItem = async (req, res) => {
  try {
    res.json(
      await decideRentalItem({
        actor: req.user,
        rentalId: req.params.requestId,
        productId: req.params.productId,
        decision: req.body.decision,
        reason: req.body.reason,
      }),
    )
  } catch (error) {
    verificationError(error, req, res, () => {})
  }
}

export const updateRentalStatus = async (req, res) => {
  const status = req.body.status
  if (['active', 'returned'].includes(status))
    return res.status(409).json({
      message:
        'Pickup and return require administrator email OTP verification. Use the rental handover dashboard.',
    })
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 500) : ''
  if (!['active', 'returned', 'completed', 'cancelled', 'disputed'].includes(status))
    return res.status(400).json({ message: 'Choose a valid booking status update.' })
  const request = await RentalRequest.findById(req.params.requestId)
  if (!request || !canManageRequest(request, req.user))
    return res.status(404).json({ message: 'Rental booking not found.' })
  if (status === 'cancelled') {
    try {
      const updated = await cancelRental({
        rentalId: req.params.requestId,
        actor: req.user,
        reason: note,
        customerFlow: false,
        ipAddress: req.ip,
      })
      return res.json({
        message: 'Booking cancelled and pending verification codes invalidated.',
        request: updated,
      })
    } catch (error) {
      return verificationError(error, req, res, () => {})
    }
  }
  if (status === 'completed' && !request.returnVerifiedAt)
    return res.status(409).json({
      message: 'The return must be verified by an administrator before completing this rental.',
    })
  if (
    ['active', 'returned', 'completed'].includes(status) &&
    request.payment?.status !== 'authorized'
  )
    return res
      .status(409)
      .json({ message: 'Collect the rental payment before progressing this booking.' })
  try {
    changeStatus(request, status, req.user, note)
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message })
  }
  await request.save()
  if (['completed', 'cancelled', 'disputed'].includes(status))
    await DeliveryLocation.deleteMany({ rentalId: request._id })
  const customer = await User.findById(request.customerId).select('email username phone')
  await notify(
    customer,
    request._id,
    `Rental ${status}`,
    `Your booking is now marked ${status.replace('_', ' ')}.${note ? ` ${note}` : ''}`,
  )
  recordAudit(req, {
    action: `booking.${status}`,
    entityType: 'rental_request',
    entityId: request._id,
    summary: `Updated booking lifecycle to ${status}.`,
  })
  res.json({ message: `Booking marked ${status}.`, request: publicRequest(request) })
}
