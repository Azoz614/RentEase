import mongoose from 'mongoose'
import { pointSchema } from '../maps/location.service.mjs'

const historySchema = new mongoose.Schema(
  {
    status: String,
    action: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
)
const challengeSchema = new mongoose.Schema(
  {
    id: String,
    kind: String,
    hash: String,
    emailHash: String,
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    maskedEmail: String,
    initiatedBy: mongoose.Schema.Types.ObjectId,
    partnerId: mongoose.Schema.Types.ObjectId,
    status: String,
    sentAt: Date,
    expiresAt: Date,
    attempts: { type: Number, default: 0 },
    verifiedAt: Date,
  },
  { _id: false },
)
const taskSchema = new mongoose.Schema(
  {
    rentalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RentalRequest',
      required: true,
      index: true,
    },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    titles: [String],
    direction: { type: String, enum: ['delivery', 'return'], required: true },
    pickup: { address: String, location: { type: pointSchema, required: true } },
    destination: { address: String, location: { type: pointSchema, required: true } },
    distanceKm: Number,
    etaMinutes: Number,
    fee: Number,
    status: {
      type: String,
      enum: [
        'available',
        'assigned',
        'heading_to_shop',
        'arrived_at_shop',
        'picked_up',
        'on_the_way',
        'delivered',
        'return_pickup',
        'heading_to_customer',
        'collected',
        'returning',
        'returned',
        'cancelled',
      ],
      default: 'available',
      index: true,
    },
    assignedPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    offeredPartnerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    declinedPartnerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    search: {
      state: { type: String, enum: ['waiting', 'searching', 'exhausted', 'assigned'], default: 'waiting' },
      radiusMeters: { type: Number, default: 2000 },
      round: { type: Number, default: 0 },
      startedAt: Date,
      nextExpansionAt: Date,
      exhaustedAt: Date,
    },
    acceptedAt: Date,
    sharing: { type: Boolean, default: false },
    locationUpdatedAt: Date,
    readyAt: Date,
    completedAt: Date,
    inspectionNote: { type: String, maxlength: 1000 },
    otp: { type: challengeSchema, select: false },
    verifications: [
      {
        kind: String,
        at: Date,
        challengeId: String,
        partnerId: mongoose.Schema.Types.ObjectId,
        providerId: mongoose.Schema.Types.ObjectId,
        recipientId: mongoose.Schema.Types.ObjectId,
        initiatedBy: mongoose.Schema.Types.ObjectId,
        verifiedBy: mongoose.Schema.Types.ObjectId,
      },
    ],
    history: [historySchema],
  },
  { timestamps: true, optimisticConcurrency: true },
)
taskSchema.index({ rentalId: 1, providerId: 1, direction: 1 }, { unique: true })
taskSchema.index({ 'pickup.location': '2dsphere' })
taskSchema.index({ status: 1, 'search.state': 1, 'search.nextExpansionAt': 1 })
export const DeliveryTask = mongoose.model('DeliveryTask', taskSchema)
