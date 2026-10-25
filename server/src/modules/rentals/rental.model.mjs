import mongoose from 'mongoose'
import { addressSchema } from '../identity/identity.model.mjs'
import { pointSchema } from '../maps/location.service.mjs'
import { deliveryStages } from '../delivery/delivery-workflow.service.mjs'

const verificationSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    otpHash: { type: String, select: false },
    emailHash: { type: String, select: false },
    expiresAt: { type: Date, required: true },
    sentAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['sending', 'sent', 'failed', 'customer_verified', 'verified'],
      required: true,
    },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    verifiedAt: Date,
  },
  { _id: false },
)

const rentalRequestSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, default: 1, min: 1, max: 1 },
        providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        title: String,
        dailyRate: Number,
        hourlyRate: Number,
        weeklyRate: Number,
        rentalAmount: Number,
        depositAmount: Number,
        billingUnit: { type: String, enum: ['day', 'hour'], default: 'day' },
        billableHours: Number,
        decision: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
        decisionReason: { type: String, maxlength: 500, default: '' },
        assignedPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        deliveryStatus: { type: String, enum: deliveryStages, default: 'assigned' },
      },
    ],
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    durationHours: Number,
    deliveryMethod: { type: String, enum: ['pickup', 'partner'], required: true },
    deliveryWorkflowVersion: Number,
    deliveryReturnRequestedAt: Date,
    address: String,
    addressSnapshot: addressSchema,
    deliveryDestination: { location: { type: pointSchema, default: undefined }, address: String },
    shipments: [
      {
        providerId: mongoose.Schema.Types.ObjectId,
        shopName: String,
        shopAddress: String,
        origin: pointSchema,
        provider: { type: String, enum: ['geoapify', 'google'] },
        distanceKm: Number,
        etaMinutes: Number,
        durationSeconds: Number,
        estimatedArrivalAt: Date,
        baseFee: Number,
        perKm: Number,
        fee: Number,
        returnBaseFee: Number,
        returnPerKm: Number,
        returnFee: Number,
        returnDistanceKm: Number,
        returnEtaMinutes: Number,
        quotedAt: Date,
      },
    ],
    returnCollectionFee: { type: Number, default: 0 },
    identityVerificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'IdentityVerification' },
    distanceKm: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    etaMinutes: { type: Number, default: 0 },
    deliveryDurationSeconds: Number,
    deliveryQuotedAt: Date,
    estimatedArrivalAt: Date,
    subtotal: { type: Number, required: true },
    total: { type: Number, required: true },
    couponCode: { type: String, default: '' },
    discountAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: [
        'pending',
        'confirmed',
        'active',
        'return_in_transit',
        'returned',
        'completed',
        'cancelled',
        'disputed',
      ],
      default: 'pending',
      index: true,
    },
    statusHistory: [
      {
        status: {
          type: String,
          enum: [
            'pending',
            'confirmed',
            'active',
            'return_in_transit',
            'returned',
            'completed',
            'cancelled',
            'disputed',
          ],
        },
        previousStatus: String,
        action: String,
        verificationId: String,
        at: { type: Date, default: Date.now },
        note: { type: String, maxlength: 500 },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    pickupVerifiedAt: Date,
    pickupCustomerVerifiedAt: Date,
    requiresPickupPreparation: Boolean,
    readyForPickupAt: Date,
    requiresReturnConfirmation: Boolean,
    returnOtpVerifiedAt: Date,
    returnInspection: {
      note: { type: String, maxlength: 1000 },
      inspectedAt: Date,
      inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    cancelledAt: Date,
    cancellationReason: { type: String, maxlength: 500 },
    pickupVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnVerifiedAt: Date,
    returnVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Embedded records make code consumption and the status transition one conditional write.
    handover: {
      pickup: { type: verificationSchema, select: false },
      return: { type: verificationSchema, select: false },
    },
    invoiceNumber: { type: String, sparse: true, unique: true },
    invoiceIssuedAt: Date,
    payment: {
      status: {
        type: String,
        enum: ['unpaid', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed'],
        default: 'unpaid',
      },
      provider: { type: String, default: 'sandbox' },
      idempotencyKey: { type: String, default: '' },
      transactionId: { type: String, default: '' },
      rentalPaid: { type: Number, default: 0, min: 0 },
      depositHeld: { type: Number, default: 0, min: 0 },
      depositRefunded: { type: Number, default: 0, min: 0 },
      paidAt: Date,
      refundedAt: Date,
      adjustments: [
        {
          type: { type: String, enum: ['late_fee', 'damage_fee'] },
          amount: { type: Number, min: 0 },
          note: { type: String, maxlength: 500 },
          createdAt: { type: Date, default: Date.now },
          createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        },
      ],
    },
  },
  { timestamps: true, optimisticConcurrency: true },
)

rentalRequestSchema.index({ status: 1, startDate: -1 })
rentalRequestSchema.index({ 'items.assignedPartner': 1, status: 1 })
rentalRequestSchema.index({ 'items.providerId': 1, status: 1 })

export const RentalRequest = mongoose.model('RentalRequest', rentalRequestSchema)
