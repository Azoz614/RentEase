import mongoose from 'mongoose'
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { RentalRequest } from './rental.model.mjs'
import { User } from '../users/user.model.mjs'
import { Product } from '../products/product.model.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { identityRate } from '../identity/identity-security.service.mjs'
import { sendRegistrationOtp } from '../../config/mailer.js'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { createHttpError as fail } from '../../utils/http-error.mjs'

const same = (a, b) => String(a) === String(b)
const digest = (value) => {
  const secret = process.env.RENTAL_OTP_SECRET || process.env.OTP_SECRET || process.env.SESSION_SECRET
  if (!secret) throw fail(503, 'OTP_NOT_CONFIGURED', 'Email verification is not configured.')
  return createHmac('sha256', secret).update(value).digest('hex')
}
const equal = (a, b) => {
  const x = Buffer.from(a || '', 'hex'), y = Buffer.from(b || '', 'hex')
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y)
}
const codeHash = (rental, challenge, code) => digest([
  'self-return', rental._id, rental.customerId, challenge.providerId,
  challenge.recipientId, challenge.challengeId, code,
].join(':'))
const emailHash = (email) => digest('self-return-email:' + email.toLowerCase())
const providerIds = (rental) => [...new Set(rental.items.filter((i) => i.decision === 'accepted').map((i) => String(i.providerId)))]

async function context(id, actor, session) {
  if (actor.role !== 'user') throw fail(403, 'CUSTOMER_REQUIRED', 'Only the booking customer can verify a self return.')
  if (!mongoose.isValidObjectId(id)) throw fail(400, 'INVALID_RENTAL', 'Choose a valid rental.')
  const query = RentalRequest.findOne({ _id: id, customerId: actor._id })
    .select('+selfReturns.hash +selfReturns.emailHash +handover.return')
  if (session) query.session(session)
  const rental = await query
  if (!rental) throw fail(404, 'RENTAL_NOT_FOUND', 'Rental not found for this account.')
  if (rental.status !== 'active' || !rental.pickupVerifiedAt)
    throw fail(409, 'INVALID_RETURN', 'Only a rental with a verified pickup currently on rental can be returned.')
  if (rental.returnMethod === 'partner' || rental.deliveryReturnRequestedAt)
    throw fail(409, 'RETURN_IN_PROGRESS', 'Partner collection is already requested. Follow its verified handovers.')
  if (rental.returnOtpVerifiedAt || rental.handover?.return?.status === 'sent')
    throw fail(409, 'RETURN_IN_PROGRESS', 'Complete the existing return verification before starting a different return.')
  return rental
}

export async function selfReturnState(id, actor) {
  const rental = await context(id, actor)
  const providers = await User.find({ _id: { $in: providerIds(rental) } }).select('username shopName').lean()
  return { handovers: providerIds(rental).map((providerId) => {
    const provider = providers.find((p) => same(p._id, providerId))
    const c = rental.selfReturns.find((c) => same(c.providerId, providerId))
    return { providerId, name: provider?.shopName || provider?.username || 'Rental provider',
      status: c?.status || 'not_started', challengeId: c?.challengeId,
      maskedEmail: c?.maskedEmail, expiresAt: c?.expiresAt,
      resendAt: c?.sentAt ? new Date(c.sentAt.getTime() + 60000) : null }
  }) }
}

export async function sendSelfReturn(id, actor, providerId, sendEmail = sendRegistrationOtp) {
  await identityRate(actor._id, 'self-return-send', 20)
  await requireTransactions()
  let challenge, recipient
  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  await mongoose.connection.transaction(async (session) => {
    const rental = await context(id, actor, session)
    if (!providerIds(rental).includes(String(providerId))) throw fail(404, 'PROVIDER_NOT_FOUND', 'This shop is not responsible for this rental.')
    recipient = await User.findOne({ _id: providerId, active: true,
      $or: [{ role: 'admin' }, { role: 'rental_shop', shopStatus: 'approved' }] })
      .select('email').session(session)
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email || ''))
      throw fail(409, 'EMAIL_REQUIRED', 'The responsible shop needs an active account and registered email.')
    const previous = rental.selfReturns.find((c) => same(c.providerId, providerId))
    if (previous?.status === 'verified') throw fail(409, 'ALREADY_VERIFIED', 'This shop return is already verified.')
    if (previous?.sentAt && Date.now() - previous.sentAt < 60000)
      throw fail(429, 'OTP_COOLDOWN', 'Wait 60 seconds before requesting another code.')
    const [name, domain] = recipient.email.split('@')
    challenge = { providerId, recipientId: recipient._id, challengeId: randomUUID(),
      maskedEmail: name.slice(0, 1) + '***@' + domain, emailHash: emailHash(recipient.email),
      status: 'sending', attempts: 0, sentAt: new Date(), expiresAt: new Date(Date.now() + 300000) }
    challenge.hash = codeHash(rental, challenge, code)
    rental.returnMethod = 'pickup'
    if (previous) previous.set(challenge)
    else rental.selfReturns.push(challenge)
    await rental.save({ session })
  })
  try {
    await sendEmail(recipient.email, code, { subject: 'RentEase self return verification',
      text: `Your RentEase return receipt code is ${code}. It expires in 5 minutes. After receiving your items for booking #${id}, give this code to the customer. The customer verifies it in RentEase to confirm your receipt.` })
  } catch {
    await RentalRequest.updateOne({ _id: id, selfReturns: { $elemMatch: { challengeId: challenge.challengeId, status: 'sending' } } },
      { $set: { 'selfReturns.$.status': 'failed' }, $unset: { 'selfReturns.$.hash': 1 } })
    throw fail(502, 'EMAIL_FAILED', 'The shop email could not be sent. Retry after 60 seconds.')
  }
  const result = await RentalRequest.updateOne({ _id: id, status: 'active', returnMethod: 'pickup',
    selfReturns: { $elemMatch: { challengeId: challenge.challengeId, status: 'sending' } } },
    { $set: { 'selfReturns.$.status': 'sent' }, $inc: { __v: 1 } })
  if (!result.modifiedCount) throw fail(409, 'RENTAL_CHANGED', 'The rental changed while the email was sending. Refresh to continue.')
  return { message: 'Code sent to the responsible shop. Ask for it after returning the items.', ...(await selfReturnState(id, actor)) }
}

export async function verifySelfReturn(id, actor, input) {
  if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code) || typeof input.challengeId !== 'string')
    throw fail(400, 'INVALID_CODE', 'Enter the six-digit code provided by the shop.')
  await identityRate(actor._id, 'self-return-verify', 100)
  const snapshot = await context(id, actor)
  const c = snapshot.selfReturns.find((c) => c.challengeId === input.challengeId)
  if (!c || c.status !== 'sent') throw fail(409, 'CODE_USED', 'This code is unavailable or already used.')
  if (c.expiresAt <= new Date()) throw fail(410, 'OTP_EXPIRED', 'The code expired. Request a new code.')
  const attempt = await RentalRequest.updateOne({ _id: id, status: 'active', returnMethod: 'pickup',
    selfReturns: { $elemMatch: { challengeId: c.challengeId, status: 'sent', attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } } } },
    { $inc: { 'selfReturns.$.attempts': 1, __v: 1 } })
  if (!attempt.modifiedCount) throw fail(429, 'CODE_LOCKED', 'Too many attempts or the code changed. Request another code.')
  if (!equal(c.hash, codeHash(snapshot, c, input.code))) throw fail(400, 'WRONG_CODE', 'The code is incorrect. Your rental has not changed.')
  await requireTransactions()
  let returned = false
  await mongoose.connection.transaction(async (session) => {
    const rental = await context(id, actor, session)
    const current = rental.selfReturns.find((entry) => entry.challengeId === c.challengeId)
    const owner = await User.findOne({ _id: c.recipientId, active: true,
      $or: [{ role: 'admin' }, { role: 'rental_shop', shopStatus: 'approved' }] }).select('email').session(session)
    if (!current || current.status !== 'sent' || current.expiresAt <= new Date() ||
      !owner || !equal(current.emailHash, emailHash(owner.email)) || !equal(current.hash, codeHash(rental, current, input.code)))
      throw fail(409, 'CODE_CHANGED', 'The code or shop account changed. Refresh and request a new code.')
    current.status = 'verified'
    current.verifiedAt = new Date()
    current.verifiedBy = actor._id
    current.hash = undefined
    returned = providerIds(rental).every((providerId) => rental.selfReturns.some((c) => same(c.providerId, providerId) && c.status === 'verified'))
    if (returned) {
      rental.status = 'returned'
      rental.returnVerifiedAt = new Date()
      rental.returnOtpVerifiedAt = rental.returnVerifiedAt
      rental.returnVerifiedBy = actor._id
      await Product.updateMany({ 'rentalSlots.requestId': rental._id },
        { $pull: { rentalSlots: { requestId: rental._id } }, $inc: { __v: 1 } }, { session })
      await User.updateOne({ _id: rental.customerId }, { $inc: { loyaltyPoints: rental.items.reduce(
        (n, i) => n + Math.max(1, Math.floor(Number(i.rentalAmount || 0) / 1000)), 0) } }, { session })
    }
    rental.statusHistory.push({ previousStatus: 'active', status: rental.status,
      action: 'return.self.verified', verificationId: c.challengeId, by: actor._id,
      note: 'Customer verified the responsible shop receipt code.' })
    await rental.save({ session })
    await AuditLog.create([{ actorId: actor._id, actorRole: actor.role, action: 'return.self.verified',
      entityType: 'rental_request', entityId: String(id), summary: `Shop ${c.providerId} receipt verified with challenge ${c.challengeId}.` }], { session })
    await Notification.create([actor._id, c.providerId].map((userId) => ({ userId, requestId: id,
      title: returned ? 'Rental returned' : 'Shop return verified', type: 'delivery', link: 'requests',
      body: returned ? 'Every shop receipt is verified. Your rental is returned.' : 'Shop receipt verified. Other shop returns are still pending.' })), { session, ordered: true })
  })
  return { returned, message: returned ? 'Return verified. Your rental is returned.' : 'Shop receipt verified. Complete the remaining shop returns.' }
}
