import mongoose from 'mongoose'

// A singleton record for values that operations staff need to adjust without a deploy.
const systemSettingSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'platform' },
    deliveryBaseFee: { type: Number, min: 0, max: 1000000, default: 0 },
    deliveryPerKm: { type: Number, min: 0, max: 1000000, default: 50 },
    deliveryPricingConfigured: { type: Boolean, default: true },
    returnCollectionBaseFee: { type: Number, min: 0, default: 0 },
    returnCollectionPerKm: { type: Number, min: 0, default: 0 },
    lateFeePerDay: { type: Number, min: 0, default: 500 },
    cancellationWindowHours: { type: Number, min: 0, max: 720, default: 24 },
    supportEmail: { type: String, trim: true, lowercase: true, default: '' },
    maintenanceMode: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

export const SystemSetting = mongoose.model('SystemSetting', systemSettingSchema)
