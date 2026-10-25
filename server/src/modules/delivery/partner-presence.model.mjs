import mongoose from 'mongoose'
import { pointSchema } from '../maps/location.service.mjs'

const schema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  location: { type: pointSchema, required: true },
  accuracy: Number,
  online: { type: Boolean, default: true },
  updatedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
})
schema.index({ location: '2dsphere' })
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export const PartnerPresence = mongoose.model('PartnerPresence', schema)
