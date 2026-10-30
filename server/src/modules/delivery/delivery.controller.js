import mongoose from 'mongoose'
import { Product } from '../products/product.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { User } from '../users/user.model.mjs'
import { recordAudit } from '../../services/audit.service.js'
import { calculateDelivery, deliveryDestination, signQuote } from './delivery-quote.service.mjs'
import { deliveryStages, progressBlock } from './delivery-workflow.service.mjs'
import { DeliveryLocation } from './delivery-location.model.mjs'
import { identityRate } from '../identity/identity-security.service.mjs'

import { notify } from '../notifications/rental-notifications.service.mjs'
import { rentalAmount, rentalPeriod } from '../rentals/rental-pricing.service.mjs'
import { priceCoupon } from '../payments/coupon.service.mjs'
import { loyaltyRewardAmount, loyaltySummary, pointsForItems } from '../loyalty/loyalty.service.mjs'
import { fromOneShop, MULTIPLE_SHOPS_MESSAGE } from '../rentals/single-shop.mjs'

export const quoteDelivery = async (req, res) => {
  if (req.user.role !== 'user')
    return res.status(403).json({ message: 'Customer access required.' })
  await identityRate(req.user._id, 'delivery-quote', 20)
  const ids = Array.isArray(req.body.productIds)
    ? [...new Set(req.body.productIds.map(String))]
    : []
  if (!ids.length || ids.length > 30 || ids.some((id) => !mongoose.isValidObjectId(id)))
    return res
      .status(400)
      .json({ message: 'Choose up to 30 rental items before calculating delivery.' })
  const products = await Product.find({ _id: { $in: ids }, active: true }).select(
    'providerId createdBy dailyRate hourlyRate weeklyRate longRentalDiscountPercent depositAmount',
  )
  if (products.length !== ids.length)
    return res.status(409).json({ message: 'A cart listing is no longer available.' })
  if (!fromOneShop(products))
    return res.status(409).json({ code: 'MULTIPLE_SHOPS', message: MULTIPLE_SHOPS_MESSAGE })
  try {
    let pricing
    if (req.body.startDate !== undefined || req.body.endDate !== undefined) {
      const period = rentalPeriod(req.body.startDate, req.body.endDate, req.body.billingUnit)
      // Mirrors createRental so the quoted total matches the booking.
      const rewardProductId = req.body.loyaltyRewardProductId ? String(req.body.loyaltyRewardProductId) : ''
      if (rewardProductId && !ids.includes(rewardProductId))
        return res.status(400).json({ message: 'Choose an item in your cart for your loyalty reward.' })
      if (rewardProductId && loyaltySummary(req.user).rewardsAvailable < 1)
        return res.status(409).json({ message: 'You have no loyalty reward available. Reach the next level to unlock one.' })
      const items = products.map((product) => {
        const amount = rentalAmount(product, period)
        const loyaltyDiscount = String(product._id) === rewardProductId ? loyaltyRewardAmount(amount) : 0
        return { productId: product._id, rentalAmount: amount - loyaltyDiscount, loyaltyDiscount }
      })
      const subtotal = items.reduce((sum, item) => sum + item.rentalAmount, 0)
      let discount
      try {
        discount = await priceCoupon(req.body.couponCode, subtotal)
      } catch (error) {
        return res.status(400).json({ message: error.message })
      }
      pricing = {
        items,
        subtotal,
        billingUnit: period.billingUnit,
        durationDays: period.dayCount,
        durationHours: period.billableHours,
        discountAmount: discount.discountAmount,
        couponCode: discount.coupon?.code || '',
        loyaltyDiscount: items.reduce((sum, item) => sum + item.loyaltyDiscount, 0),
        depositAmount: products.reduce(
          (sum, product) => sum + Number(product.depositAmount || 0),
          0,
        ),
      }
    }
    const quote = await calculateDelivery(products, deliveryDestination(req.user, req.body))
    res.set('Cache-Control', 'private, no-store')
    return res.json({
      ...quote,
      ...(pricing
        ? {
            pricing: {
              ...pricing,
              deliveryFee: quote.deliveryFee,
              returnCollectionFee: quote.returnCollectionFee,
              total:
                Math.round(
                  (pricing.subtotal -
                    pricing.discountAmount +
                    quote.deliveryFee +
                    quote.returnCollectionFee) *
                    100,
                ) / 100,
            },
          }
        : {}),
      quoteToken: signQuote(req.user, products, quote),
      expiresAt: new Date(Date.now() + 5 * 60000),
    })
  } catch (error) {
    return res
      .status(error.status || 502)
      .json({ message: error.status ? error.message : 'Could not calculate a delivery route. Try again shortly.' })
  }
}

export const listAssignments = async (req, res) => {
  if (req.user.role !== 'delivery_partner')
    return res.status(403).json({ message: 'Delivery partner access is required.' })
  const requests = await RentalRequest.find({
    'items.assignedPartner': req.user._id,
    deliveryMethod: 'partner',
    deliveryWorkflowVersion: { $ne: 2 },
    status: { $in: ['confirmed', 'active', 'returned'] },
  })
    .select(
      '_id customerId items startDate endDate status address shipments deliveryDestination distanceKm etaMinutes deliveryFee pickupVerifiedAt returnVerifiedAt returnOtpVerifiedAt +handover.return',
    )
    .populate('customerId', 'username phone')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
  for (const request of requests) {
    request.items = request.items
      .filter(
        (item) =>
          String(item.assignedPartner) === String(req.user._id) &&
          item.decision === 'accepted' &&
          item.deliveryStatus !== 'returned',
      )
      .map((item) => {
        const next = deliveryStages[deliveryStages.indexOf(item.deliveryStatus) + 1]
        return {
          productId: item.productId,
          title: item.title,
          decision: item.decision,
          deliveryStatus: item.deliveryStatus,
          providerId: item.providerId,
          progressBlocked: next ? progressBlock(request, item, next) : '',
        }
      })
    request.shipments = request.shipments?.filter((shipment) =>
      request.items.some((item) => String(item.providerId) === String(shipment.providerId)),
    )
    request.distanceKm =
      request.shipments?.reduce((sum, shipment) => sum + shipment.distanceKm, 0) ?? 0
    request.deliveryFee =
      request.shipments?.reduce((sum, shipment) => sum + shipment.fee + shipment.returnFee, 0) ?? 0
    delete request.handover
  }
  res.set('Cache-Control', 'private, no-store')
  res.json({ requests: requests.filter((request) => request.items.length) })
}

export const updateAssignmentStatus = async (req, res) => {
  if (req.user.role !== 'delivery_partner')
    return res.status(403).json({ message: 'Delivery partner access is required.' })
  const allowed = deliveryStages
  const status = req.body.status
  if (!allowed.includes(status))
    return res.status(400).json({ message: 'Choose a valid delivery status.' })
  if (
    !mongoose.isValidObjectId(req.params.requestId) ||
    !mongoose.isValidObjectId(req.params.productId)
  )
    return res.status(400).json({ message: 'Choose a valid delivery assignment.' })
  const request = await RentalRequest.findOne({
    _id: req.params.requestId,
    items: { $elemMatch: { productId: req.params.productId, assignedPartner: req.user._id } },
  }).select('+handover.return')
  if (!request) return res.status(404).json({ message: 'Delivery assignment not found.' })
  if (request.deliveryWorkflowVersion === 2)
    return res.status(409).json({ message: 'Use the OTP-secured delivery task workflow.' })
  const item = request.items.find(
    (entry) =>
      String(entry.productId) === req.params.productId &&
      String(entry.assignedPartner) === String(req.user._id),
  )
  const blocked = progressBlock(request, item, status)
  if (blocked) return res.status(409).json({ message: blocked })
  item.deliveryStatus = status
  try {
    await request.save()
  } catch (error) {
    if (error.name === 'VersionError')
      return res.status(409).json({ message: 'This assignment changed. Refresh and try again.' })
    throw error
  }
  if (['delivered', 'returned'].includes(status))
    await DeliveryLocation.deleteOne({ rentalId: request._id, productId: item.productId })
  recordAudit(req, {
    action: `delivery.${status}`,
    entityType: 'rental_request',
    entityId: request._id,
    summary: `Updated delivery status for ${item.title} to ${status}.`,
  })
  const customer = await User.findById(request.customerId).select('email username phone')
  const labels = Object.fromEntries(
    deliveryStages.map((stage) => [stage, stage.replaceAll('_', ' ')]),
  )
  const pointsAwarded = status === 'returned' ? pointsForItems([item]) : 0
  if (pointsAwarded)
    await User.updateOne({ _id: request.customerId }, { $inc: { loyaltyPoints: pointsAwarded } })
  await notify(
    customer,
    request._id,
    'Delivery update',
    `${item.title}: ${labels[status]}.${pointsAwarded ? ` You earned ${pointsAwarded} RentEase loyalty point(s).` : ''}`,
  )
  const provider = await User.findById(item.providerId).select('email username phone')
  await notify(provider, request._id, 'Delivery update', `${item.title}: ${labels[status]}.`)
  res.json({ message: `Delivery status updated: ${labels[status]}.` })
}
