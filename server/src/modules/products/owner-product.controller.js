import { Product } from './product.model.mjs'
import { RentalReview } from './rental-review.model.mjs'
import { recordAudit } from '../../services/audit.service.js'
import {
  removeProductPhotos,
  saveProductPhotos,
} from './product-images.service.mjs'

export const listOwnerProducts = async (req, res) => {
  if (req.user.role !== 'rental_shop')
    return res.status(403).json({ message: 'Rental shop access is required.' })
  const products = await Product.find({
    $or: [{ providerId: req.user._id }, { createdBy: req.user._id }],
  })
    .sort({ createdAt: -1 })
    .lean()
  res.json({ products })
}

export const createOwnerProduct = async (req, res) => {
  if (req.user.role !== 'rental_shop')
    return res.status(403).json({ message: 'Rental shop access is required.' })
  const { title, category, description } = req.body
  const dailyRate = Number(req.body.dailyRate)
  const depositAmount = Number(req.body.depositAmount || 0)
  const optionalRate = (value) => (value === undefined || value === '' ? undefined : Number(value))
  const hourlyRate = optionalRate(req.body.hourlyRate)
  const weeklyRate = optionalRate(req.body.weeklyRate)
  const longRentalDiscountPercent = Number(req.body.longRentalDiscountPercent || 0)
  const leadTimeHours = Number(req.body.leadTimeHours ?? 24)
  const photos = Array.isArray(req.body.photos) ? req.body.photos : []
  if (![title, category, description].every((value) => typeof value === 'string' && value.trim()))
    return res
      .status(400)
      .json({ message: 'Product name, category, and description are required.' })
  if (
    !Number.isFinite(dailyRate) ||
    dailyRate < 0 ||
    !Number.isFinite(depositAmount) ||
    depositAmount < 0
  )
    return res.status(400).json({ message: 'Enter valid rental and deposit amounts.' })
  if (
    [hourlyRate, weeklyRate].some(
      (rate) => rate !== undefined && (!Number.isFinite(rate) || rate < 0),
    ) ||
    !Number.isFinite(longRentalDiscountPercent) ||
    longRentalDiscountPercent < 0 ||
    longRentalDiscountPercent > 90
  )
    return res
      .status(400)
      .json({ message: 'Enter valid hourly, weekly, and long-rental discount prices.' })
  if (!Number.isFinite(leadTimeHours) || leadTimeHours < 0 || leadTimeHours > 720)
    return res.status(400).json({ message: 'Enter a preparation time from 0 to 720 hours.' })
  if (photos.length < 1 || photos.length > 6)
    return res.status(400).json({ message: 'Add between 1 and 6 product photos.' })
  const savedPaths = []
  try {
    const saved = await saveProductPhotos(photos)
    savedPaths.push(...saved.newPaths)
    const specifications = Array.isArray(req.body.specifications)
      ? req.body.specifications
          .slice(0, 20)
          .map((row) => ({
            name: String(row.name || '').trim(),
            value: String(row.value || '').trim(),
          }))
          .filter((row) => row.name && row.value)
      : []
    const product = await Product.create({
      title: title.trim(),
      category: category.trim(),
      description: description.trim(),
      dailyRate,
      hourlyRate,
      weeklyRate,
      longRentalDiscountPercent,
      depositAmount,
      leadTimeHours,
      specifications,
      photos: savedPaths,
      location: req.user.shopAddress || 'Shop location not confirmed',
      createdBy: req.user._id,
      providerId: req.user._id,
    })
    recordAudit(req, {
      action: 'product.created',
      entityType: 'product',
      entityId: product._id,
      summary: `Created rental listing ${product.title}.`,
    })
    return res.status(201).json({ message: 'Rental listing published.', product })
  } catch (error) {
    await removeProductPhotos(savedPaths)
    const isInputError =
      error.message.startsWith('Use JPEG') || error.message.startsWith('Each photo')
    return res
      .status(isInputError ? 400 : 500)
      .json({ message: isInputError ? error.message : 'Could not publish this listing.' })
  }
}

export const updateOwnerProduct = async (req, res) => {
  if (req.user.role !== 'rental_shop')
    return res.status(403).json({ message: 'Rental shop access is required.' })
  const product = await Product.findOne({
    _id: req.params.id,
    $or: [{ providerId: req.user._id }, { createdBy: req.user._id }],
  })
  if (!product) return res.status(404).json({ message: 'Your listing was not found.' })
  const updates = {}
  for (const field of ['title', 'category', 'description']) {
    if (req.body[field] !== undefined) {
      if (typeof req.body[field] !== 'string' || !req.body[field].trim())
        return res.status(400).json({ message: `${field} cannot be empty.` })
      updates[field] = req.body[field].trim()
    }
  }
  for (const field of [
    'dailyRate',
    'depositAmount',
    'hourlyRate',
    'weeklyRate',
    'longRentalDiscountPercent',
  ]) {
    if (req.body[field] !== undefined) {
      if ((field === 'hourlyRate' || field === 'weeklyRate') && req.body[field] === '') {
        updates[field] = undefined
        continue
      }
      const amount = Number(req.body[field])
      if (
        !Number.isFinite(amount) ||
        amount < 0 ||
        (field === 'longRentalDiscountPercent' && amount > 90)
      )
        return res.status(400).json({
          message: `Enter a valid ${field === 'dailyRate' ? 'daily rate' : field === 'depositAmount' ? 'deposit amount' : field === 'longRentalDiscountPercent' ? 'discount from 0 to 90' : 'rental rate'}.`,
        })
      updates[field] = amount
    }
  }
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== 'boolean')
      return res.status(400).json({ message: 'Listing status must be active or inactive.' })
    if (req.body.active && product.adminDisabled)
      return res.status(403).json({
        message: 'RentEase removed this listing. Contact support to have it reviewed.',
      })
    updates.active = req.body.active
  }
  let newImagePaths = [],
    removedImagePaths = []
  if (req.body.photos !== undefined) {
    try {
      const result = await saveProductPhotos(req.body.photos, product.photos)
      updates.photos = result.photos
      newImagePaths = result.newPaths
      removedImagePaths = product.photos.filter((photo) => !result.photos.includes(photo))
    } catch (error) {
      return res
        .status(error.status || 500)
        .json({ message: error.status ? error.message : 'Could not save the product photos.' })
    }
  }
  try {
    Object.assign(product, updates)
    await product.save()
  } catch (error) {
    await removeProductPhotos(newImagePaths)
    throw error
  }
  await removeProductPhotos(removedImagePaths)
  recordAudit(req, {
    action: 'product.updated',
    entityType: 'product',
    entityId: product._id,
    summary: `Updated rental listing ${product.title}.`,
  })
  res.json({ message: 'Listing updated.', product })
}

// Reviews customers left on this shop's listings, grouped by product for the owner workspace.
export const listOwnerReviews = async (req, res) => {
  if (req.user.role !== 'rental_shop')
    return res.status(403).json({ message: 'Rental shop access is required.' })
  const [products, reviews] = await Promise.all([
    Product.find({ providerId: req.user._id })
      .select('title category photos ratingAverage ratingCount active')
      .sort({ createdAt: -1 })
      .lean(),
    RentalReview.find({ targetId: req.user._id, direction: 'customer_to_owner' })
      .populate('authorId', 'username')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
  ])
  const grouped = products.map((product) => {
    const own = reviews.filter((review) => String(review.productId) === String(product._id))
    return {
      _id: product._id,
      title: product.title,
      category: product.category,
      photo: product.photos?.[0] || null,
      active: product.active,
      ratingAverage: own.length ? own.reduce((sum, review) => sum + review.rating, 0) / own.length : 0,
      ratingCount: own.length,
      reviews: own.map((review) => ({
        _id: review._id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        author: review.authorId?.username || 'Customer',
      })),
    }
  })
  const total = reviews.length
  res.json({
    products: grouped,
    summary: {
      ratingCount: total,
      ratingAverage: total ? reviews.reduce((sum, review) => sum + review.rating, 0) / total : 0,
    },
  })
}
