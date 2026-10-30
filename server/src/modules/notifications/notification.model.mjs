import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalRequest' },
    deliveryTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryTask' },
    handoverChallengeId: { type: String, select: false },
    expiresAt: Date,
    title: { type: String, required: true },
    body: { type: String, required: true },
    readAt: { type: Date, default: null },
    type: { type: String, default: 'rental' },
    link: {
      type: String,
      enum: ['verification', 'addresses', 'requests', 'inbox'],
      default: 'inbox',
    },
  },
  { timestamps: true },
)

notificationSchema.index(
  { userId: 1, deliveryTaskId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { deliveryTaskId: { $exists: true } },
  },
)
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export const Notification = mongoose.model('Notification', notificationSchema)
