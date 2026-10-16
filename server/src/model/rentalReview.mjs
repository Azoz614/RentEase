import mongoose from 'mongoose'

const rentalReviewSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalRequest', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  direction: { type: String, enum: ['customer_to_owner', 'owner_to_customer'], required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, trim: true, maxlength: 1200, default: '' },
}, { timestamps: true })

rentalReviewSchema.index({ requestId: 1, productId: 1, authorId: 1 }, { unique: true })
export const RentalReview = mongoose.model('RentalReview', rentalReviewSchema)
