import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
import { User } from '../users/user.model.mjs'
import { PasswordReset } from './password-reset.model.mjs'
import { sendRegistrationOtp } from '../../config/mailer.js'
import { deferAuthEmail } from './auth-email-tasks.mjs'
import {
  authError, authHandler, authHash, authRate, challengeTimes, emailValue,
  matchesHash, newProof, OTP_TTL, validEmail, validatePassword,
} from './auth-security.service.mjs'

const invalidCode = () => authError(400, 'That code is incorrect, expired, or already used. Request a new code if needed.')
const invalidReset = () => authError(400, 'Your password reset expired or was already used. Please request a new code.')

export function createPasswordResetHandlers({ sendEmail = sendRegistrationOtp, defer = deferAuthEmail } = {}) {
  return {
    sendPasswordResetCode: authHandler(async (req, res) => {
      const email = emailValue(req.body.email)
      if (!validEmail(email)) throw authError(400, 'Enter a valid email address.')
      await authRate(req, 'password-reset-send', email, true)
      const sentAt = new Date()
      defer(async () => {
        const user = await User.findOne({ email, active: true }).select('_id password')
        if (!user) return
        const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
        const otpHash = authHash('password-reset-otp', `${email}:${otp}`)
        await PasswordReset.findOneAndUpdate({ email }, {
          $set: { email, userId: user._id, passwordFingerprint: authHash('password', user.password),
            otpHash, attempts: 0, sentAt, expiresAt: new Date(sentAt.getTime() + OTP_TTL) },
          $unset: { resetTokenHash: 1, verifiedAt: 1 },
        }, { upsert: true, returnDocument: 'after', runValidators: true })
        try {
          await sendEmail(email, otp, {
            subject: 'Reset your RentEase password',
            text: `Your RentEase password reset code is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
          })
        } catch {
          await PasswordReset.deleteOne({ email, otpHash })
          // Do not confirm account existence through SMTP failures either.
          console.error('Password reset email could not be delivered.')
        }
      })
      res.json({
        message: 'If an eligible account uses this email, a reset code will arrive shortly. If it does not arrive, check spam or try resending.',
        ...challengeTimes(sentAt),
      })
    }),

    verifyPasswordResetCode: authHandler(async (req, res) => {
      const email = emailValue(req.body.email), { otp } = req.body
      if (!validEmail(email) || typeof otp !== 'string' || !/^\d{6}$/.test(otp))
        throw authError(400, 'Enter the six-digit code from your email.')
      await authRate(req, 'password-reset-verify', email)
      const record = await PasswordReset.findOneAndUpdate({
        email, verifiedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 },
      }, { $inc: { attempts: 1 } }, { returnDocument: 'after' }).select('+otpHash')
      if (!record || !matchesHash(record.otpHash, authHash('password-reset-otp', `${email}:${otp}`)))
        throw invalidCode()
      const resetToken = newProof()
      const claimed = await PasswordReset.updateOne({
        _id: record._id, otpHash: record.otpHash, verifiedAt: null, expiresAt: { $gt: new Date() },
      }, { $set: { verifiedAt: new Date(), resetTokenHash: authHash('password-reset-token', resetToken) }, $unset: { otpHash: 1 } })
      if (!claimed.modifiedCount) throw invalidCode()
      res.json({ message: 'Email verified. Choose your new password.', resetToken, expiresAt: record.expiresAt })
    }),

    resetPassword: authHandler(async (req, res) => {
      const email = emailValue(req.body.email), { resetToken, password, confirmPassword } = req.body
      if (!validEmail(email)) throw authError(400, 'Enter a valid email address.')
      validatePassword(password, confirmPassword)
      await authRate(req, 'password-reset-complete', email)
      if (typeof resetToken !== 'string' || resetToken.length !== 43) throw invalidReset()
      const proof = { email, resetTokenHash: authHash('password-reset-token', resetToken), verifiedAt: { $ne: null }, expiresAt: { $gt: new Date() } }
      const record = await PasswordReset.findOne(proof).select('+passwordFingerprint')
      if (!record) throw invalidReset()
      const user = await User.findOne({ _id: record.userId, email, active: true }).select('password')
      if (!user || !matchesHash(record.passwordFingerprint, authHash('password', user.password))) throw invalidReset()
      if (await bcrypt.compare(password, user.password))
        throw authError(400, 'Choose a password different from your current password.')
      const passwordHash = await bcrypt.hash(password, 12)
      await mongoose.connection.transaction(async (session) => {
        const claimed = await PasswordReset.findOneAndDelete({ ...proof, expiresAt: { $gt: new Date() } }, { session })
        if (!claimed) throw invalidReset()
        const updated = await User.updateOne({ _id: user._id, email, active: true, password: user.password }, {
          $set: { password: passwordHash }, $inc: { sessionVersion: 1, __v: 1 },
        }, { session })
        if (!updated.modifiedCount) throw invalidReset()
      })
      res.json({ message: 'Password reset successfully. Please sign in with your new password.' })
    }),
  }
}

export const { sendPasswordResetCode, verifyPasswordResetCode, resetPassword } = createPasswordResetHandlers()
