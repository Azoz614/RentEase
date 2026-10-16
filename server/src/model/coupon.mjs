import mongoose from 'mongoose'

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32, index: true },
  kind: { type: String, enum: ['percent', 'fixed'], required: true },
  value: { type: Number, required: true, min: 0 },
  minimumSubtotal: { type: Number, default: 0, min: 0 },
  maximumDiscount: { type: Number, min: 0 },
  startsAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  maxRedemptions: { type: Number, min: 1 },
  redemptionCount: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true })

export const Coupon = mongoose.model('Coupon', couponSchema)
