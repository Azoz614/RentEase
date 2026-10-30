import { createHmac, timingSafeEqual } from 'node:crypto'
import { AccountOtp } from './account-otp.model.mjs'
import { confirmAccountPassword } from '../identity/identity-security.service.mjs'

export const otpSecret = () => process.env.OTP_SECRET || process.env.SESSION_SECRET

export const hashAccountOtp = (userId, purpose, otp, targetEmail = '') =>
  createHmac('sha256', otpSecret())
    .update(`${userId}:${purpose}:${targetEmail}:${otp}`)
    .digest('hex')

export async function verifyAccountChange(req, purpose) {
  if (typeof req.body.password === 'string' && req.body.password) {
    await confirmAccountPassword(req.user, req.body.password)
    return
  }
  const otp = typeof req.body.verificationOtp === 'string' ? req.body.verificationOtp.trim() : ''
  if (!/^\d{6}$/.test(otp))
    throw Object.assign(
      new Error('Enter your current password or request and enter the email verification code.'),
      { status: 400 },
    )
  await consumeAccountOtp(req.user._id, purpose, otp)
}

export async function consumeAccountOtp(userId, purpose, otp, targetEmail = '') {
  // Spend the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
  const record = await AccountOtp.findOneAndUpdate(
    { userId, purpose, targetEmail, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  )
  if (!record) {
    const existing = await AccountOtp.findOne({ userId, purpose, targetEmail }).select('expiresAt')
    if (existing && existing.expiresAt > new Date())
      throw Object.assign(new Error('Too many incorrect codes. Request a new verification code.'), {
        status: 429,
      })
    throw Object.assign(new Error('Your verification code has expired. Request a new one.'), {
      status: 400,
    })
  }
  const expected = Buffer.from(record.otpHash, 'hex')
  const submitted = Buffer.from(hashAccountOtp(userId, purpose, otp, targetEmail), 'hex')
  if (expected.length !== submitted.length || !timingSafeEqual(expected, submitted))
    throw Object.assign(new Error('That verification code is incorrect.'), { status: 400 })
  if (!(await AccountOtp.deleteOne({ _id: record._id })).deletedCount)
    throw Object.assign(new Error('This code was already used. Request a new one.'), { status: 400 })
}
