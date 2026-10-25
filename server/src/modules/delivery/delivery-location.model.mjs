import mongoose from 'mongoose'
import { pointSchema } from '../maps/location.service.mjs'

// One short-lived position per assigned item; never a location history.
const schema = new mongoose.Schema({
  rentalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  partnerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  location: { type: pointSchema, required: true },
  accuracy: Number,
  updatedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
})
schema.index({ rentalId: 1, productId: 1 }, { unique: true })
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
schema.index({ location: '2dsphere' })
export const DeliveryLocation = mongoose.model('DeliveryLocation', schema)
