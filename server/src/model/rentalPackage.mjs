import mongoose from 'mongoose'

const rentalPackageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }],
  optionalAddOnIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  dailyRate: { type: Number, required: true, min: 0 },
  weeklyRate: { type: Number, min: 0 },
  active: { type: Boolean, default: true, index: true },
  startsAt: { type: Date },
  endsAt: { type: Date },
}, { timestamps: true })

export const RentalPackage = mongoose.model('RentalPackage', rentalPackageSchema)
