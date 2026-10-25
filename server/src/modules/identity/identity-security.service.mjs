import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { VerificationRate } from '../otp/verification-rate.model.mjs'
import { User } from '../users/user.model.mjs'

export const identityError = (status, code, message) =>
  Object.assign(new Error(message), { status, code })
export const DUPLICATE_NIC =
  'This NIC number is already registered. Please check the number or contact support if you believe there is a mistake.'
export function identityKey(name) {
  const value = process.env[name] || ''
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32 || key.toString('base64') !== value)
    throw identityError(
      503,
      'IDENTITY_NOT_CONFIGURED',
      `Identity security is not configured. Ask your administrator to set ${name} to a base64-encoded 32-byte key.`,
    )
  return key
}
export function encryptIdentity(data, context) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', identityKey('IDENTITY_ENCRYPTION_KEY'), iv)
  cipher.setAAD(Buffer.from(context))
  return Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()])
}
export function decryptIdentity(data, context) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    identityKey('IDENTITY_ENCRYPTION_KEY'),
    buffer.subarray(0, 12),
  )
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(buffer.subarray(-16))
  return Buffer.concat([decipher.update(buffer.subarray(12, -16)), decipher.final()])
}
export function parseNic(value, dob) {
  const normalized = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : ''
  if (!/^(?:\d{9}[VX]|\d{12})$/.test(normalized))
    throw identityError(
      400,
      'INVALID_NIC',
      'Enter a valid NIC: 9 digits followed by V or X, or 12 digits.',
    )
  const old = normalized.length === 10
  const canonical = old ? `19${normalized.slice(0, 5)}0${normalized.slice(5, 9)}` : normalized
  const year = Number(canonical.slice(0, 4)),
    rawDay = Number(canonical.slice(4, 7)),
    day = rawDay > 500 ? rawDay - 500 : rawDay
  if (year < 1900 || year > new Date().getFullYear() || day < 1 || day > 366 || rawDay === 500)
    throw identityError(
      400,
      'INVALID_NIC',
      'The NIC birth-year or day code is invalid. Check your card or contact support.',
    )
  if (dob !== undefined) {
    const date = new Date(`${dob}T00:00:00Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dob || '') ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== dob ||
      date > new Date() ||
      date.getUTCFullYear() !== year
    )
      throw identityError(
        400,
        'NIC_DOB_MISMATCH',
        'Enter a valid date of birth matching the NIC birth year. Contact support for a card discrepancy.',
      )
    const ordinal = Math.round((date - Date.UTC(year, 0, 1)) / 86400000) + 1
    const nonLeap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1
    if (day !== ordinal && !(nonLeap && date.getUTCMonth() >= 2 && day === ordinal + 1))
      throw identityError(
        400,
        'NIC_DOB_MISMATCH',
        'The date of birth does not match the NIC day code. Check your details or contact support.',
      )
  }
  return {
    normalized,
    canonical,
    masked: `${normalized.slice(0, 2)}${'•'.repeat(normalized.length - 5)}${normalized.slice(-3)}`,
    digest: createHmac('sha256', identityKey('IDENTITY_HASH_KEY')).update(canonical).digest('hex'),
  }
}
export async function identityRate(userId, action, limit = 10) {
  const now = Date.now(),
    windowMs = 15 * 60000,
    bucket = Math.floor(now / windowMs)
  const filter = { _id: `identity:${userId}:${action}:${bucket}` },
    update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) } }
  let result
  try {
    result = await VerificationRate.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after',
    })
  } catch (error) {
    if (error.code !== 11000) throw error
    result = await VerificationRate.findOneAndUpdate(filter, update, { returnDocument: 'after' })
  }
  if (result.count > limit)
    throw Object.assign(
      identityError(429, 'REAUTH_RATE_LIMIT', 'Too many attempts. Please try again later.'),
      { retryAfter: Math.ceil(((bucket + 1) * windowMs - now) / 1000) },
    )
}
export async function confirmAccountPassword(actor, password) {
  await identityRate(actor._id, 'password', 5)
  const user = await User.findById(actor._id).select('password')
  if (
    typeof password !== 'string' ||
    password.length > 128 ||
    !user ||
    !(await bcrypt.compare(password, user.password))
  )
    throw identityError(401, 'PASSWORD_INCORRECT', 'Incorrect password. Please try again.')
}
