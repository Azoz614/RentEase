import mongoose from 'mongoose'
import { RentalReview } from './rental-review.model.mjs'

// Shared by guest and authenticated catalog routes so counts and filters agree.
export async function listProductReviewPage(req, res) {
  if (!mongoose.isValidObjectId(req.params.productId))
    return res.status(400).json({ message: 'Choose a valid listing.' })
  const page = req.query.page === undefined ? 1 : Number(req.query.page)
  const rating = req.query.rating === undefined ? null : Number(req.query.rating)
  const sort = req.query.sort || 'newest'
  const sorts = { newest: { createdAt: -1, _id: -1 }, highest: { rating: -1, createdAt: -1, _id: -1 }, lowest: { rating: 1, createdAt: -1, _id: -1 } }
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) || !Object.hasOwn(sorts, sort))
    return res.status(400).json({ message: 'Choose a valid review page, star rating, and sort order.' })
  const match = { productId: new mongoose.Types.ObjectId(req.params.productId), direction: 'customer_to_owner' }
  const filtered = { ...match, ...(rating !== null && { rating }) }
  const pageSize = 10
  const [reviews, total, groups] = await Promise.all([
    RentalReview.find(filtered).select('rating comment createdAt authorId').populate('authorId', 'username').sort(sorts[sort]).skip((page - 1) * pageSize).limit(pageSize).lean(),
    RentalReview.countDocuments(filtered),
    RentalReview.aggregate([{ $match: match }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
  ])
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let count = 0, score = 0
  for (const group of groups) {
    distribution[group._id] = group.count
    count += group.count
    score += group._id * group.count
  }
  res.json({ reviews, summary: { ratingAverage: count ? score / count : 0, ratingCount: count, distribution }, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } })
}
