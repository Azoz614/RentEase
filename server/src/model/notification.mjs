import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalRequest' },
  title: { type: String, required: true }, body: { type: String, required: true },
  readAt: { type: Date, default: null },
}, { timestamps: true })

export const Notification = mongoose.model('Notification', notificationSchema)
