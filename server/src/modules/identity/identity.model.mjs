import mongoose from 'mongoose'
import { pointSchema } from '../maps/location.service.mjs'

export const addressFields = {
  location: { type: pointSchema, default: undefined },
  line1: { type: String, maxlength: 150 },
  line2: { type: String, maxlength: 150, default: '' },
  city: { type: String, maxlength: 80 },
  district: { type: String, maxlength: 80 },
  province: { type: String, maxlength: 80 },
  postalCode: { type: String, maxlength: 12, default: '' },
  country: { type: String, default: 'Sri Lanka', maxlength: 60 },
}
export const addressSchema = new mongoose.Schema(addressFields, { _id: false })
const documentSchema = new mongoose.Schema(
  { filename: String, mime: String, size: Number, uploadedAt: Date },
  { _id: false },
)
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    nicDigest: { type: String, select: false },
    nicEncrypted: { type: String, select: false },
    nicMasked: String,
    fullName: String,
    dateOfBirth: String,
    phone: String,
    email: String,
    address: addressSchema,
    front: { type: documentSchema, select: false },
    back: { type: documentSchema, select: false },
    status: {
      type: String,
      enum: ['not_submitted', 'pending', 'approved', 'rejected', 'resubmission_required'],
      default: 'not_submitted',
      index: true,
    },
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, maxlength: 500, default: '' },
    consentAt: Date,
    revision: { type: Number, default: 0 },
    documentsDeletedAt: Date,
    retentionUntil: Date,
    history: [
      {
        previousStatus: String,
        status: String,
        reason: { type: String, maxlength: 500 },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true, optimisticConcurrency: true },
)
schema.index(
  { nicDigest: 1 },
  { unique: true, partialFilterExpression: { nicDigest: { $type: 'string' } } },
)
schema.index({ status: 1, submittedAt: 1 })
export const IdentityVerification = mongoose.model('IdentityVerification', schema)

const disputeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nicDigest: { type: String, required: true, select: false },
    message: { type: String, maxlength: 1000, required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolution: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
)
disputeSchema.index({ userId: 1, status: 1 })
export const IdentityDispute = mongoose.model('IdentityDispute', disputeSchema)
