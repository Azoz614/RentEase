import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Binding the challenge to the current hash invalidates it after another password change.
  passwordFingerprint: { type: String, required: true, select: false },
  otpHash: { type: String, select: false },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  resetTokenHash: { type: String, select: false },
  verifiedAt: Date,
})

export const PasswordReset = mongoose.model('PasswordReset', schema)
