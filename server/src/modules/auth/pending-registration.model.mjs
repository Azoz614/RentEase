import mongoose from 'mongoose'

const pendingRegistrationSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  accountType: { type: String, enum: ['user', 'rental_shop'], default: 'user' },
  shopName: { type: String, trim: true, default: '' },
  otpHash: { type: String, required: true },
  otpExpiresAt: { type: Date, required: true },
  otpAttempts: { type: Number, default: 0 },
  lastOtpSentAt: { type: Date, required: true },
  verifiedAt: { type: Date, default: null },
  verificationTokenHash: { type: String, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})

export const PendingRegistration = mongoose.model('PendingRegistration', pendingRegistrationSchema)
