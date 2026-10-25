import mongoose from 'mongoose'
import { Product } from './product.model.mjs'
import { RentalReview } from './rental-review.model.mjs'
import { RentalPackage } from './rental-package.model.mjs'
import { inventoryAvailability, availabilityView } from './availability.service.mjs'

export const listPublicProducts = async (_req, res) => {
  const products = await Product.find({ active: true })
    .select(
      'title category description dailyRate hourlyRate weeklyRate longRentalDiscountPercent depositAmount ratingAverage ratingCount specifications location photos providerId leadTimeHours createdAt',
    )
    .populate('providerId', 'username shopName shopLocation shopAddress')
    .sort({ createdAt: -1 })
    .lean()
  const availability = await inventoryAvailability(products)
  res.json({
    products: products.map((product) => ({
      ...product,
      location: product.providerId?.shopAddress || product.location,
      ...availabilityView(availability.get(String(product._id))),
    })),
  })
}

export const listPublicPackages = async (_req, res) => {
  const now = new Date()
  const packages = await RentalPackage.find({
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  })
    .populate('productIds', 'title category description dailyRate photos active')
    .populate('optionalAddOnIds', 'title category description dailyRate photos active')
    .sort({ createdAt: -1 })
    .lean()
  res.json({
    packages: packages.map((rentalPackage) => ({
      ...rentalPackage,
      productIds: rentalPackage.productIds.filter((item) => item.active),
      optionalAddOnIds: rentalPackage.optionalAddOnIds.filter((item) => item.active),
    })),
  })
}

export const listPublicReviews = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId))
    return res.status(400).json({ message: 'Choose a valid listing.' })
  const reviews = await RentalReview.find({
    productId: req.params.productId,
    direction: 'customer_to_owner',
  })
    .populate('authorId', 'username')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()
  res.json({ reviews })
}
