import mongoose from 'mongoose'

const rentalRequestSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: String, dailyRate: Number, hourlyRate: Number, weeklyRate: Number, rentalAmount: Number, depositAmount: Number,
    billingUnit: { type: String, enum: ['day', 'hour'], default: 'day' }, billableHours: Number,
    decision: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    assignedPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deliveryStatus: { type: String, enum: ['assigned', 'on_the_way', 'delivered', 'return_pickup', 'returning', 'returned'], default: 'assigned' },
  }],
  startDate: { type: Date, required: true }, endDate: { type: Date, required: true },
  deliveryMethod: { type: String, enum: ['pickup', 'partner'], required: true }, address: String,
  distanceKm: { type: Number, default: 0 }, deliveryFee: { type: Number, default: 0 }, etaMinutes: { type: Number, default: 0 },
  subtotal: { type: Number, required: true }, total: { type: Number, required: true },
  couponCode: { type: String, default: '' }, discountAmount: { type: Number, default: 0, min: 0 },
}, { timestamps: true })

export const RentalRequest = mongoose.model('RentalRequest', rentalRequestSchema)
