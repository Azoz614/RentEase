import { listProductReviewPage } from './product-reviews.controller.mjs'
import { validPoint, haversine } from '../maps/distance.service.mjs'
import mongoose from 'mongoose'
import { Product } from './product.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { User } from '../users/user.model.mjs'
import { recordAudit } from '../../services/audit.service.js'
import { RentalReview } from './rental-review.model.mjs'
import { RentalPackage } from './rental-package.model.mjs'
import { inventoryAvailability, availabilityView, bookableProviders } from './availability.service.mjs'
import { mapsKey } from '../delivery/delivery-quote.service.mjs'
import { loyaltyOverview, loyaltySummary } from '../loyalty/loyalty.service.mjs'

import { notify } from '../notifications/rental-notifications.service.mjs'

export const listProducts = async (req, res) => {
  const products = await Product.find({ active: true, ...(await bookableProviders()) })
    .populate('providerId', 'username shopName shopLocation shopAddress')
    .sort({ createdAt: -1 })
    .lean()
  const start = req.query.startDate ? new Date(req.query.startDate) : null
  const end = req.query.endDate ? new Date(req.query.endDate) : null
  if (
    end &&
    (!Number.isFinite(start?.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start >= end ||
      start < new Date(new Date().setHours(0, 0, 0, 0)))
  )
    return res
      .status(400)
      .json({ message: 'Choose valid rental start and end dates to check availability.' })
  const origin =
    req.user.addressLocation && validPoint(req.user.addressLocation)
      ? req.user.addressLocation
      : null
  const availability = await inventoryAvailability(products, start, end)
  res.set('Cache-Control', 'private, no-store')
  res.json({
    products: products.map((product) => {
      const { rentalSlots: _rentalSlots, ...publicProduct } = product
      const location = product.providerId?.shopLocation
      const coordinates = location
        ? { latitude: location.coordinates[1], longitude: location.coordinates[0] }
        : null
      const distanceKm = origin && coordinates ? haversine(origin, coordinates) : null
      return {
        ...publicProduct,
        location: product.providerId?.shopAddress || product.location,
        coordinates,
        ...availabilityView(availability.get(String(product._id))),
        distanceKm,
        distanceType: 'geographic',
        estimatedDeliveryFee: null,
        // Current reservations only (a count, never the dates), used to rank trending items.
        bookingCount: product.rentalSlots?.length || 0,
      }
    }),
    address: req.user.defaultAddress || '',
    nic: req.user.nic || '',
    loyaltyPoints: req.user.loyaltyPoints || 0,
    loyalty: loyaltySummary(req.user),
    mapsConfigured: Boolean(mapsKey()),
  })
}

export const getLoyalty = async (req, res) => {
  if (req.user.role !== 'user')
    return res.status(403).json({ message: 'Loyalty rewards are for customer accounts.' })
  res.set('Cache-Control', 'private, no-store')
  res.json(await loyaltyOverview(req.user))
}

export const listPackages = async (req, res) => {
  const start = req.query.startDate ? new Date(req.query.startDate) : null
  const end = req.query.endDate ? new Date(req.query.endDate) : null
  if (
    (start || end) &&
    (!Number.isFinite(start?.getTime()) || !Number.isFinite(end?.getTime()) || start >= end)
  )
    return res
      .status(400)
      .json({ message: 'Choose valid rental dates to check package availability.' })
  const now = new Date()
  const packages = await RentalPackage.find({
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  })
    .populate(
      'productIds',
      'title category description dailyRate weeklyRate photos active rentalSlots',
    )
    .populate(
      'optionalAddOnIds',
      'title category description dailyRate weeklyRate photos active rentalSlots',
    )
    .sort({ createdAt: -1 })
    .lean()
  const availability = await inventoryAvailability(
    packages.flatMap((entry) => [...entry.productIds, ...entry.optionalAddOnIds]),
    start,
    end,
  )
  const visible = packages.map((rentalPackage) => {
    const required = rentalPackage.productIds.filter((item) => item.active)
    const optional = rentalPackage.optionalAddOnIds.filter((item) => item.active)
    const available =
      required.length === rentalPackage.productIds.length &&
      required.every((item) => availability.get(String(item._id)).available)
    return {
      ...rentalPackage,
      productIds: required.map(({ rentalSlots: _rentalSlots, ...item }) => item),
      optionalAddOnIds: optional.map(({ rentalSlots: _rentalSlots, ...item }) => item),
      available,
    }
  })
  res.json({ packages: visible })
}

export const quotePackage = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.packageId))
    return res.status(400).json({ message: 'Choose a valid rental package.' })
  const start = new Date(req.body.startDate),
    end = new Date(req.body.endDate)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end)
    return res.status(400).json({ message: 'Choose valid rental dates.' })
  const rentalPackage = await RentalPackage.findOne({ _id: req.params.packageId, active: true })
    .populate('productIds', 'title dailyRate weeklyRate active rentalSlots')
    .populate('optionalAddOnIds', 'title dailyRate weeklyRate active rentalSlots')
  if (!rentalPackage || rentalPackage.productIds.some((item) => !item.active))
    return res.status(404).json({ message: 'This package is not currently available.' })
  const addOnIds = Array.isArray(req.body.addOnIds)
    ? [...new Set(req.body.addOnIds.map(String))]
    : []
  if (
    addOnIds.some(
      (id) =>
        !mongoose.isValidObjectId(id) ||
        !rentalPackage.optionalAddOnIds.some((item) => String(item._id) === id),
    )
  )
    return res.status(400).json({ message: 'Choose valid optional add-ons for this package.' })
  const selectedAddOns = rentalPackage.optionalAddOnIds.filter((item) =>
    addOnIds.includes(String(item._id)),
  )
  const selectedItems = [...rentalPackage.productIds, ...selectedAddOns]
  const availability = await inventoryAvailability(selectedItems, start, end)
  if (selectedItems.some((item) => !item.active || !availability.get(String(item._id)).available))
    return res
      .status(409)
      .json({ message: 'One or more package items are booked or currently on rental.' })
  const days = Math.max(1, Math.ceil((end - start) / 86400000))
  const packageWeeks = Math.floor(days / 7),
    remainingDays = days % 7
  const packageAmount =
    days >= 7 && rentalPackage.weeklyRate
      ? packageWeeks * Number(rentalPackage.weeklyRate) +
        remainingDays * Number(rentalPackage.dailyRate)
      : days * Number(rentalPackage.dailyRate)
  const addOnAmount = selectedAddOns.reduce(
    (total, item) => total + days * Number(item.dailyRate || 0),
    0,
  )
  res.json({
    package: { id: rentalPackage._id, name: rentalPackage.name },
    days,
    packageAmount,
    addOnAmount,
    total: packageAmount + addOnAmount,
    addOns: selectedAddOns.map((item) => ({
      id: item._id,
      title: item.title,
      amount: days * Number(item.dailyRate || 0),
    })),
  })
}

export const listWishlist = async (req, res) => {
  const user = await User.findById(req.user._id).select('wishlist')
  const products = await Product.find({ _id: { $in: user?.wishlist || [] }, active: true, ...(await bookableProviders()) })
    .populate('providerId', 'username shopName')
    .lean()
  res.json({ products })
}

export const saveWishlistProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId))
    return res.status(400).json({ message: 'Choose a valid listing.' })
  if (!(await Product.exists({ _id: req.params.productId, active: true })))
    return res.status(404).json({ message: 'This listing is not available to save.' })
  await User.updateOne({ _id: req.user._id }, { $addToSet: { wishlist: req.params.productId } })
  res.json({ message: 'Listing saved to your wishlist.' })
}

export const removeWishlistProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId))
    return res.status(400).json({ message: 'Choose a valid listing.' })
  await User.updateOne({ _id: req.user._id }, { $pull: { wishlist: req.params.productId } })
  res.json({ message: 'Listing removed from your wishlist.' })
}

export const listProductReviews = listProductReviewPage

export const createReview = async (req, res) => {
  const { requestId, productId } = req.body
  const rating = Number(req.body.rating)
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : ''
  if (!mongoose.isValidObjectId(requestId) || !mongoose.isValidObjectId(productId))
    return res.status(400).json({ message: 'Choose a valid completed rental item.' })
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1200)
    return res
      .status(400)
      .json({ message: 'Choose a 1–5 star rating and keep your comment under 1200 characters.' })
  const request = await RentalRequest.findById(requestId)
  const item = request?.items.find((entry) => String(entry.productId) === String(productId))
  if (!request || !item || item.decision !== 'accepted')
    return res.status(404).json({ message: 'Completed rental item not found.' })
  // Only rentals that actually happened can be reviewed; reviews move trust scores.
  const complete =
    ['returned', 'completed'].includes(request.status) ||
    (request.status !== 'cancelled' && item.deliveryStatus === 'returned')
  if (!complete)
    return res.status(409).json({ message: 'Reviews open after the rental period is complete.' })
  const isCustomer = String(request.customerId) === String(req.user._id)
  const isOwner = String(item.providerId) === String(req.user._id)
  if (!isCustomer && !isOwner)
    return res
      .status(403)
      .json({ message: 'Only the renter or listing provider can review this rental.' })
  const targetId = isCustomer ? item.providerId : request.customerId
  try {
    const review = await RentalReview.create({
      requestId,
      productId,
      authorId: req.user._id,
      targetId,
      direction: isCustomer ? 'customer_to_owner' : 'owner_to_customer',
      rating,
      comment,
    })
    if (isCustomer) {
      const [summary] = await RentalReview.aggregate([
        {
          $match: {
            productId: new mongoose.Types.ObjectId(productId),
            direction: 'customer_to_owner',
          },
        },
        { $group: { _id: '$productId', average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      if (summary)
        await Product.updateOne(
          { _id: productId },
          { $set: { ratingAverage: summary.average, ratingCount: summary.count } },
        )
    }
    const received = await RentalReview.aggregate([
      { $match: { targetId: new mongoose.Types.ObjectId(targetId) } },
      { $group: { _id: '$targetId', average: { $avg: '$rating' } } },
    ])
    if (received[0])
      await User.updateOne(
        { _id: targetId },
        { $set: { trustScore: Math.round(received[0].average * 20) } },
      )
    const target = await User.findById(targetId).select('email phone username')
    await notify(
      target,
      request._id,
      'New rental review',
      `${req.user.username} left you a ${rating}-star review.`,
    )
    recordAudit(req, {
      action: 'review.created',
      entityType: 'rental_request',
      entityId: request._id,
      summary: `Submitted a ${rating}-star rental review.`,
    })
    res.status(201).json({ message: 'Thank you. Your review has been saved.', review })
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ message: 'You already reviewed this rental item.' })
    throw error
  }
}
