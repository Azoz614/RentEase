import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  _id: String,
  kind: { type: String, enum: ['rental', 'delivery'], required: true },
  rentalId: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalRequest', required: true, index: true },
  deliveryTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryTask' },
  beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  direction: { type: String, enum: ['delivery', 'return'] },
  currency: { type: String, default: 'LKR' },
  grossMinor: { type: Number, required: true, min: 0 },
  commissionMinor: { type: Number, required: true, min: 0 },
  netMinor: { type: Number, required: true, min: 0 },
  rateBasisPoints: { type: Number, required: true },
  refundedGrossMinor: { type: Number, default: 0, min: 0 },
  reversedCommissionMinor: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['pending', 'earned', 'settled', 'reversed'], default: 'pending', index: true },
  paymentProvider: String,
  earnedAt: Date,
  settledAt: Date,
  settlementReference: String,
}, { timestamps: true })
schema.index({ createdAt: -1, kind: 1, status: 1 })
export const CommissionEntry = mongoose.model('CommissionEntry', schema)
