import mongoose from 'mongoose'

const accountOtpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  purpose: { type: String, enum: ['profile_update', 'password_change', 'email_change'], required: true },
  targetEmail: { type: String, lowercase: true, trim: true, default: '' },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
}, { timestamps: true })

accountOtpSchema.index({ userId: 1, purpose: 1 }, { unique: true })
accountOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const AccountOtp = mongoose.model('AccountOtp', accountOtpSchema)
