import { listProductReviewPage } from './product-reviews.controller.mjs'
import { Product } from './product.model.mjs'
import { RentalPackage } from './rental-package.model.mjs'
import { inventoryAvailability, availabilityView, bookableProviders } from './availability.service.mjs'

export const listPublicProducts = async (_req, res) => {
  const products = await Product.find({ active: true, ...(await bookableProviders()) })
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

export const listPublicReviews = listProductReviewPage
