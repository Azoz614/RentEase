import mongoose from 'mongoose'
import { addressFields } from '../identity/identity.model.mjs'
import { pointSchema } from '../maps/location.service.mjs'

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 10,
    },
    sessionVersion: { type: Number, default: 0, select: false },
    // Wrong passwords entered while accepting rentals; no default so a missing count reads as null.
    approvalPasswordFailures: { type: Number, select: false },
    approvalPasswordLockedUntil: { type: Date, select: false },
    googleSubject: { type: String, select: false },
    role: {
      type: String,
      enum: ['user', 'delivery_partner', 'rental_shop', 'admin'],
      default: 'user',
      index: true,
    },
    shopName: { type: String, trim: true, default: '' },
    shopLocation: { type: pointSchema, default: undefined },
    shopAddress: { type: String, trim: true, maxlength: 600 },
    shopStatus: {
      type: String,
      enum: ['not_applicable', 'pending', 'approved', 'rejected'],
      default: 'not_applicable',
      index: true,
    },
    active: { type: Boolean, default: true, index: true },
    activeDeliveryTask: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryTask' },
    defaultAddress: { type: String, trim: true, default: '' },
    nic: { type: String, uppercase: true, trim: true, default: '', select: false },
    addresses: [
      {
        ...addressFields,
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    defaultAddressId: mongoose.Schema.Types.ObjectId,
    addressLocation: { latitude: Number, longitude: Number },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    loyaltyPoints: { type: Number, default: 0, min: 0 },
    // Level rewards spent on bookings; a level is every 10 points (see loyalty.service.mjs).
    loyaltyRewardsUsed: { type: Number, default: 0, min: 0 },
    trustScore: { type: Number, default: 50, min: 0, max: 100 },
    identityStatus: {
      type: String,
      enum: ['not_submitted', 'pending', 'approved', 'rejected', 'resubmission_required'],
      default: 'not_submitted',
      index: true,
    },
    identityFrontPath: { type: String, default: '', select: false },
    identityBackPath: { type: String, default: '', select: false },
    identitySubmittedAt: { type: Date },
    identityReviewNote: { type: String, maxlength: 500, default: '' },
  },
  { timestamps: true, optimisticConcurrency: true },
)

userSchema.index({ shopLocation: '2dsphere' })
userSchema.index({ googleSubject: 1 }, { unique: true, partialFilterExpression: { googleSubject: { $type: 'string' } } })
userSchema.index({ 'addresses.location': '2dsphere' })
export const User = mongoose.model('User', userSchema)
