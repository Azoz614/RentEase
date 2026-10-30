import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { VerificationRate } from '../otp/verification-rate.model.mjs'

export const OTP_TTL = 10 * 60_000
export const RESEND_DELAY = 60_000
export const authError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra })
export const emailValue = (value) => typeof value === 'string' ? value.trim().toLowerCase() : ''
export const validEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
export function validatePassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128 || Buffer.byteLength(password, 'utf8') > 72)
    throw authError(400, 'Use at least 10 characters and no more than 72 bytes for your password.')
  if (confirmation !== undefined && password !== confirmation)
    throw authError(400, 'Your passwords do not match.')
}
export function authHash(purpose, value) {
  const secret = process.env.OTP_SECRET || process.env.SESSION_SECRET
  if (!secret) throw authError(503, 'Email verification is temporarily unavailable. Please try again later.')
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex')
}
export const newProof = () => randomBytes(32).toString('base64url')
export const registrationCookieOptions = (req) => ({
  httpOnly: true, secure: req.secure || process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api',
})
export function registrationCookie(req) {
  return (req.get('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith('rentease_registration='))?.slice('rentease_registration='.length)
}
export function matchesHash(expected, actual) {
  if (!expected || !actual) return false
  const a = Buffer.from(expected, 'hex'), b = Buffer.from(actual, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
export const challengeTimes = (sentAt = new Date()) => ({
  serverTime: new Date().toISOString(),
  expiresAt: new Date(sentAt.getTime() + OTP_TTL).toISOString(),
  resendAt: new Date(sentAt.getTime() + RESEND_DELAY).toISOString(),
})

// Persistent limits also work across Worker restarts. Identifiers are HMACs, not emails/IPs.
export async function rate(key, limit, windowMs = 15 * 60_000) {
  const now = Date.now(), bucket = Math.floor(now / windowMs)
  const filter = { _id: `auth:${authHash('rate', key)}:${bucket}` }
  const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) } }
  let record
  try {
    record = await VerificationRate.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after' })
  } catch (error) {
    if (error.code !== 11000) throw error
    record = await VerificationRate.findOneAndUpdate(filter, update, { returnDocument: 'after' })
  }
  if (record.count > limit)
    throw authError(429, 'Too many attempts. Please try again later.', { retryAfter: Math.ceil(((bucket + 1) * windowMs - now) / 1000) })
}
export async function authRate(req, action, email, sending = false) {
  await rate(`${action}:ip:${req.ip || 'unknown'}`, sending ? 30 : 60)
  await rate(`${action}:email:${email}`, sending ? 5 : 20)
  if (!sending) return
  const _id = `auth:cooldown:${authHash(action, email)}`, now = new Date()
  try {
    await VerificationRate.findOneAndUpdate({ _id, expiresAt: { $lte: now } }, {
      $set: { expiresAt: new Date(now.getTime() + RESEND_DELAY), count: 1 },
    }, { upsert: true, returnDocument: 'after' })
  } catch (error) {
    if (error.code !== 11000) throw error
    const previous = await VerificationRate.findById(_id)
    throw authError(429, 'Please wait before requesting another code.', {
      retryAfter: Math.max(1, Math.ceil(((previous?.expiresAt?.getTime() || Date.now() + RESEND_DELAY) - Date.now()) / 1000)),
    })
  }
}

export const authHandler = (handler) => async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    await handler(req, res)
  } catch (error) {
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
    if (error.code === 11000) return res.status(409).json({ message: 'An account already uses that username or email.' })
    if (!error.status) console.error('Authentication request failed:', error.name)
    res.status(error.status || 500).json({
      message: error.status ? error.message : 'We could not complete this request. Please try again.',
      ...(typeof error.code === 'string' && { code: error.code }),
      ...(error.retryAfter && { retryAfter: error.retryAfter }),
    })
  }
}
