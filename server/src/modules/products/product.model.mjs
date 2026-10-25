import mongoose from 'mongoose'

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    dailyRate: { type: Number, required: true, min: 0 },
    hourlyRate: { type: Number, min: 0 },
    weeklyRate: { type: Number, min: 0 },
    longRentalDiscountPercent: { type: Number, default: 0, min: 0, max: 90 },
    depositAmount: { type: Number, default: 0, min: 0 },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    specifications: [
      {
        name: { type: String, trim: true, maxlength: 60 },
        value: { type: String, trim: true, maxlength: 160 },
      },
    ],
    location: { type: String, required: true, trim: true, default: 'Batticaloa' },
    photos: { type: [String], validate: (photos) => photos.length >= 1 && photos.length <= 6 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    coordinates: {
      latitude: { type: Number, default: 7.7102 },
      longitude: { type: Number, default: 81.6924 },
    },
    leadTimeHours: { type: Number, default: 24, min: 0 },
    rentalSlots: [
      {
        requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalRequest' },
        startDate: Date,
        endDate: Date,
        status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
      },
    ],
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

export const Product = mongoose.model('Product', productSchema)
