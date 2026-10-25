import { createHttpError as failure } from '../../utils/http-error.mjs'
import { requireTransactions, transactionsAvailable } from '../../services/mongo-transactions.mjs'
import mongoose from 'mongoose'
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { RentalRequest } from './rental.model.mjs'
import { Product } from '../products/product.model.mjs'
import { User } from '../users/user.model.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { VerificationRate } from '../otp/verification-rate.model.mjs'
import { DeliveryLocation } from '../delivery/delivery-location.model.mjs'
import { sendHandoverOtp } from '../../config/mailer.js'

export const OTP_EXPIRY_MS = 5 * 60_000
export const OTP_COOLDOWN_MS = 60_000
export const OTP_MAX_ATTEMPTS = 5
const expectedStatus = { pickup: 'confirmed', return: 'active' }
const nextStatus = { pickup: 'active', return: 'returned' }

const secret = () =>
  process.env.RENTAL_OTP_SECRET || process.env.OTP_SECRET || process.env.SESSION_SECRET
const digest = (value) => {
  if (!secret())
    throw failure(
      503,
      'OTP_NOT_CONFIGURED',
      'Email verification is not configured. Contact your system administrator.',
    )
  return createHmac('sha256', secret()).update(value).digest('hex')
}
export const hashRentalOtp = (rentalId, customerId, type, challengeId, code) =>
  digest(`${rentalId}:${customerId}:${type}:${challengeId}:${code}`)
const emailDigest = (email) => digest(`email:${email.toLowerCase()}`)
const secureEqual = (a, b) => {
  const first = Buffer.from(a || '', 'hex'),
    second = Buffer.from(b || '', 'hex')
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second)
}
export const maskEmail = (email) => {
  const [name, domain] = email.split('@')
  return `${name.slice(0, 1)}***@${domain}`
}

function validateContext(actor, rentalId, type, customerFlow = false) {
  if (!actor?._id || (!customerFlow && !['admin', 'rental_shop'].includes(actor.role)))
    throw failure(
      403,
      'ADMIN_REQUIRED',
      'Only authorized rental staff can verify rental handovers.',
    )
  if (!mongoose.isValidObjectId(rentalId))
    throw failure(400, 'INVALID_RENTAL', 'Choose a valid rental.')
  if (!Object.hasOwn(expectedStatus, type))
    throw failure(400, 'INVALID_ACTION', 'Choose pickup or return verification.')
}

const rentalFilter = (rentalId, actor, customerFlow) => ({
  _id: rentalId,
  ...(customerFlow
    ? { customerId: actor._id }
    : actor.role === 'rental_shop'
      ? { 'items.providerId': actor._id, items: { $not: { $elemMatch: { providerId: { $ne: actor._id } } } } }
      : {}),
})

export function pickupWorkflow(rental) {
  const challenge = rental.handover?.pickup
  const status =
    rental.status === 'cancelled'
      ? 'cancelled'
      : rental.pickupVerifiedAt
        ? 'handed_over'
        : rental.pickupCustomerVerifiedAt
          ? 'customer_verified'
          : challenge?.status === 'sent' && new Date(challenge.expiresAt) > new Date()
            ? 'pending'
            : 'not_started'
  return {
    status,
    customerVerifiedAt: rental.pickupCustomerVerifiedAt || null,
    sentAt: challenge?.sentAt || null,
    expiresAt: challenge?.expiresAt || null,
  }
}

export function returnWorkflow(rental) {
  const challenge = rental.handover?.return
  const status =
    rental.status === 'cancelled'
      ? 'cancelled'
      : rental.returnVerifiedAt
        ? 'returned'
        : challenge?.status === 'sent' && new Date(challenge.expiresAt) > new Date()
          ? 'pending'
          : 'not_started'
  return { status, sentAt: challenge?.sentAt || null, expiresAt: challenge?.expiresAt || null }
}

export async function activeVerificationChallenge({ rentalId, type, actor, customerFlow = false }) {
  validateContext(actor, rentalId, type, customerFlow)
  const rental = await RentalRequest.findOne(rentalFilter(rentalId, actor, customerFlow)).select(
    `+handover.${type}`,
  )
  assertHandoverEligible(rental, type)
  const customer = await User.findById(rental.customerId).select('email')
  const challenge = rental.handover?.[type]
  const response = {
    serverTime: new Date(),
    ...(type === 'pickup'
      ? { pickupVerification: pickupWorkflow(rental) }
      : { returnVerification: returnWorkflow(rental) }),
  }
  if (challenge?.status === 'sent' && challenge.expiresAt > new Date()) {
    Object.assign(response, {
      challengeId: challenge.challengeId,
      maskedEmail: maskEmail(customer?.email || ''),
      expiresAt: challenge.expiresAt,
      resendAt: new Date(challenge.sentAt.getTime() + OTP_COOLDOWN_MS),
      attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - challenge.attempts),
    })
  }
  return response
}

export async function customerPickupChallenge({ rentalId, actor }) {
  return activeVerificationChallenge({ rentalId, type: 'pickup', actor, customerFlow: true })
}

export async function customerReturnChallenge({ rentalId, actor }) {
  return activeVerificationChallenge({ rentalId, type: 'return', actor, customerFlow: true })
}

export function assertHandoverEligible(rental, type) {
  if (type === 'return' && rental?.returnMethod)
    throw failure(409, 'RETURN_METHOD_SELECTED', 'Complete the selected return method in the customer return screen.')
  if (rental?.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner')
    throw failure(
      409,
      'DELIVERY_OTP_REQUIRED',
      'This booking uses delivery task handover codes, not self-pickup verification.',
    )
  if (!rental) throw failure(404, 'RENTAL_NOT_FOUND', 'Rental not found.')
  if (rental.status !== expectedStatus[type])
    throw failure(
      409,
      'INVALID_STATUS',
      type === 'pickup'
        ? 'Only booked rentals can be collected.'
        : 'Only rentals currently on rental can be returned.',
    )
  if (
    type === 'pickup' &&
    (!rental.items.length ||
      !rental.items.every((item) => item.decision === 'accepted') ||
      !['authorized', 'paid'].includes(rental.payment?.status))
  ) {
    throw failure(
      409,
      'PAYMENT_REQUIRED',
      'All items must be accepted and payment collected before pickup.',
    )
  }
  if (type === 'pickup' && rental.requiresPickupPreparation && !rental.readyForPickupAt)
    throw failure(
      409,
      'PICKUP_NOT_READY',
      'An administrator is preparing your items. Pickup verification opens when they mark the booking ready.',
    )
  if (type === 'return' && !rental.pickupVerifiedAt)
    throw failure(
      409,
      'PICKUP_NOT_VERIFIED',
      'This rental needs a verified pickup before its return can be verified. Review historical rentals with support.',
    )
}

// Shared database counters work across API processes and are not reset by a restart.
async function consumeRate(actorId, action, now) {
  const windowMs = 15 * 60_000
  const bucket = Math.floor(now.getTime() / windowMs)
  const limit = action === 'send' ? 20 : 100
  const filter = { _id: `${actorId}:${action}:${bucket}` }
  const update = {
    $inc: { count: 1 },
    $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) },
  }
  let record
  try {
    record = await VerificationRate.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after',
    })
  } catch (error) {
    if (error.code !== 11000) throw error
    record = await VerificationRate.findOneAndUpdate(filter, update, { returnDocument: 'after' })
  }
  if (record.count > limit)
    throw failure(429, 'RATE_LIMIT', 'Too many verification requests. Please try again later.', {
      retryAfter: Math.ceil(((bucket + 1) * windowMs - now.getTime()) / 1000),
    })
}

export async function initiateVerification({
  rentalId,
  type,
  actor,
  sendEmail = sendHandoverOtp,
  customerFlow = false,
}) {
  validateContext(actor, rentalId, type, customerFlow)
  const now = new Date()
  await consumeRate(actor._id, 'send', now)
  const rental = await RentalRequest.findOne(rentalFilter(rentalId, actor, customerFlow)).select(
    `+handover.${type}`,
  )
  assertHandoverEligible(rental, type)
  if (type === 'pickup' && rental.pickupCustomerVerifiedAt)
    throw failure(
      409,
      'CUSTOMER_ALREADY_VERIFIED',
      'Your email is verified. An administrator must now confirm physical handover.',
    )
  if (type === 'return' && rental.returnOtpVerifiedAt)
    throw failure(
      409,
      'RETURN_ALREADY_VERIFIED',
      'The return email is verified. Confirm physical receipt and inspection instead.',
    )
  const customer = await User.findById(rental.customerId).select('email')
  if (!customer?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
    throw failure(
      409,
      'EMAIL_UNAVAILABLE',
      'The customer needs a valid registered email before verification.',
    )
  const previous = rental.handover?.[type]
  const retryAfter = previous
    ? Math.ceil((new Date(previous.sentAt).getTime() + OTP_COOLDOWN_MS - now.getTime()) / 1000)
    : 0
  if (retryAfter > 0)
    throw failure(
      429,
      'OTP_COOLDOWN',
      `Wait ${retryAfter} seconds before requesting another code.`,
      { retryAfter },
    )
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const challengeId = randomUUID()
  const path = `handover.${type}`
  const challenge = {
    challengeId,
    customerId: rental.customerId,
    otpHash: hashRentalOtp(rentalId, rental.customerId, type, challengeId, code),
    emailHash: emailDigest(customer.email),
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS),
    sentAt: now,
    attempts: 0,
    status: 'sending',
    initiatedBy: actor._id,
  }
  const claimed = await RentalRequest.findOneAndUpdate(
    {
      _id: rentalId,
      status: expectedStatus[type],
      customerId: rental.customerId,
      ...(type === 'pickup' ? { pickupCustomerVerifiedAt: null } : { returnOtpVerifiedAt: null }),
      $or: [
        { [`${path}.sentAt`]: { $exists: false } },
        { [`${path}.sentAt`]: { $lte: new Date(now.getTime() - OTP_COOLDOWN_MS) } },
      ],
    },
    { $set: { [path]: challenge }, $inc: { __v: 1 } },
    { returnDocument: 'after' },
  )
  if (!claimed)
    throw failure(
      409,
      'VERIFICATION_CHANGED',
      'Another administrator updated this rental or requested a code. Refresh and try again.',
    )
  try {
    await sendEmail(customer.email, code, type, String(rental._id))
  } catch (error) {
    // Never log an OTP, recipient address, SMTP credentials, or the mail provider response body.
    // The concise transport code is enough to diagnose connectivity/authentication failures in the API terminal.
    console.error(
      `Rental ${type} OTP delivery failed (${error?.code || error?.name || 'unknown transport error'}).`,
    )
    await RentalRequest.updateOne(
      { _id: rentalId, [`${path}.challengeId`]: challengeId },
      { $set: { [`${path}.status`]: 'failed' }, $unset: { [`${path}.otpHash`]: 1 } },
    )
    throw failure(
      502,
      'EMAIL_FAILED',
      'The verification email could not be delivered. Check email settings and request a new code after 60 seconds.',
      { retryAfter: 60 },
    )
  }
  const sent = await RentalRequest.updateOne(
    {
      _id: rentalId,
      status: expectedStatus[type],
      [`${path}.challengeId`]: challengeId,
      [`${path}.status`]: 'sending',
    },
    { $set: { [`${path}.status`]: 'sent' } },
  )
  if (!sent.modifiedCount)
    throw failure(
      409,
      'VERIFICATION_CHANGED',
      'This rental changed while the email was sending. Refresh before continuing.',
    )
  return {
    challengeId,
    maskedEmail: maskEmail(customer.email),
    expiresAt: challenge.expiresAt,
    resendAt: new Date(now.getTime() + OTP_COOLDOWN_MS),
    serverTime: new Date(),
    message: 'Verification code sent to the customer.',
  }
}

export async function verifyHandover({
  rentalId,
  type,
  challengeId,
  code,
  actor,
  ipAddress = '',
  customerFlow = false,
}) {
  validateContext(actor, rentalId, type, customerFlow)
  if (
    typeof code !== 'string' ||
    !/^\d{6}$/.test(code) ||
    typeof challengeId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(challengeId)
  )
    throw failure(400, 'INVALID_CODE', 'Enter the six-digit code sent to the customer.')
  const supportsTransactions = await transactionsAvailable()
  if (type !== 'pickup' && !supportsTransactions) await requireTransactions()
  await consumeRate(actor._id, 'verify', new Date())
  const path = `handover.${type}`
  const rental = await RentalRequest.findOne(rentalFilter(rentalId, actor, customerFlow)).select(
    `+${path} +${path}.otpHash +${path}.emailHash`,
  )
  assertHandoverEligible(rental, type)
  const challenge = rental.handover?.[type]
  const now = new Date()
  if (!challenge || challenge.challengeId !== challengeId || challenge.status !== 'sent')
    throw failure(
      409,
      'CODE_UNAVAILABLE',
      'This verification code is no longer available. Request a new code.',
    )
  if (challenge.expiresAt <= now)
    throw failure(410, 'OTP_EXPIRED', 'This verification code has expired. Request a new code.')
  if (challenge.attempts >= OTP_MAX_ATTEMPTS)
    throw failure(
      429,
      'ATTEMPTS_EXHAUSTED',
      'Too many incorrect codes. Request a new code after the resend countdown.',
    )
  const customer = await User.findById(rental.customerId).select('email')
  if (
    !customer?.email ||
    String(challenge.customerId) !== String(rental.customerId) ||
    !secureEqual(challenge.emailHash, emailDigest(customer.email))
  )
    throw failure(
      409,
      'CUSTOMER_CHANGED',
      'Customer details changed. Request a new verification code.',
    )
  // Every submission reserves an attempt atomically before checking its value.
  const attempt = await RentalRequest.updateOne(
    {
      _id: rentalId,
      status: expectedStatus[type],
      [`${path}.challengeId`]: challengeId,
      [`${path}.status`]: 'sent',
      [`${path}.attempts`]: { $lt: OTP_MAX_ATTEMPTS },
      [`${path}.expiresAt`]: { $gt: now },
    },
    { $inc: { [`${path}.attempts`]: 1, __v: 1 } },
  )
  if (!attempt.modifiedCount)
    throw failure(
      409,
      'VERIFICATION_CHANGED',
      'The code was used, expired, or reached its attempt limit. Refresh or request a new code.',
    )
  if (
    !secureEqual(
      challenge.otpHash,
      hashRentalOtp(rentalId, rental.customerId, type, challengeId, code),
    )
  )
    throw failure(400, 'OTP_INCORRECT', 'The verification code is incorrect. Please try again.')
  const timestampField = type === 'pickup' ? 'pickupVerifiedAt' : 'returnVerifiedAt'
  const actorField = type === 'pickup' ? 'pickupVerifiedBy' : 'returnVerifiedBy'
  // A customer may request delivery of a code, but only an administrator consumes it.
  // Customer-initiated codes complete the handover immediately; existing admin-initiated
  // preparation/inspection workflows keep their separate physical confirmation step.
  const customerInitiated = String(challenge.initiatedBy) === String(rental.customerId)
  const stageOnly =
    customerFlow ||
    (!customerInitiated &&
      ((type === 'pickup' && rental.requiresPickupPreparation) ||
        (type === 'return' && rental.requiresReturnConfirmation)))
  let updated
  if (type === 'pickup' && !supportsTransactions) {
    // A conditional document update is enough for pickup: it consumes this exact
    // unexpired challenge and switches the rental to active in the same write.
    // This lets the existing SMTP OTP flow work with a standalone MongoDB server.
    const verifiedAt = new Date()
    updated = await RentalRequest.findOneAndUpdate(
      {
        _id: rentalId,
        status: expectedStatus[type],
        customerId: rental.customerId,
        [`${path}.challengeId`]: challengeId,
        [`${path}.status`]: 'sent',
        [`${path}.expiresAt`]: { $gt: verifiedAt },
      },
      {
        $set: stageOnly
          ? {
              pickupCustomerVerifiedAt: verifiedAt,
              [`${path}.status`]: 'customer_verified',
              [`${path}.verifiedAt`]: verifiedAt,
            }
          : {
              status: nextStatus[type],
              pickupVerifiedAt: verifiedAt,
              pickupVerifiedBy: actor._id,
              [`${path}.status`]: 'verified',
              [`${path}.verifiedAt`]: verifiedAt,
            },
        $unset: { [`${path}.otpHash`]: 1, [`${path}.emailHash`]: 1 },
        $inc: { __v: 1 },
        $push: {
          statusHistory: {
            previousStatus: expectedStatus[type],
            status: stageOnly ? expectedStatus[type] : nextStatus[type],
            action: stageOnly ? 'pickup.customer_verified' : 'pickup.verified',
            verificationId: challengeId,
            at: verifiedAt,
            by: actor._id,
            note: stageOnly
              ? 'Customer email verified. Physical handover awaits administrator confirmation.'
              : 'Pickup verified using the customer email code.',
          },
        },
      },
      { returnDocument: 'after', runValidators: true },
    )
    if (!updated)
      throw failure(
        409,
        'VERIFICATION_CHANGED',
        'This code was already used or the rental changed. Refresh the dashboard.',
      )
    if (!stageOnly)
      await Product.updateMany(
        { _id: { $in: rental.items.map((item) => item.productId) } },
        { $inc: { __v: 1 } },
      )
    try {
      await AuditLog.create({
        actorId: actor._id,
        actorRole: actor.role,
        action: customerFlow ? 'rental.pickup.customer_verified' : 'rental.pickup.verified',
        entityType: 'rental_request',
        entityId: String(rental._id),
        summary: `${customerFlow ? 'Customer email' : 'Pickup'} verified for rental ${rental._id}. Verification ${challengeId}.`,
        ipAddress,
      })
    } catch (error) {
      // The handover record is already durable; an audit outage must not report a
      // successful OTP as a failed pickup to the administrator.
      console.error(`Rental pickup audit logging failed (${error?.name || 'unknown error'}).`)
    }
    return {
      rental: updated.toObject(),
      message: stageOnly
        ? 'Email verified. The rental status stays unchanged until an administrator confirms physical handover.'
        : 'Pickup verified successfully. Rental is now active.',
    }
  }
  await mongoose.connection.transaction(
    async (session) => {
      const verifiedAt = new Date()
      const currentCustomer = await User.findOne({ _id: rental.customerId, email: customer.email })
        .session(session)
        .select('_id')
      if (!currentCustomer)
        throw failure(409, 'CUSTOMER_CHANGED', 'Customer details changed. Request a new code.')
      updated = await RentalRequest.findOneAndUpdate(
        {
          _id: rentalId,
          status: expectedStatus[type],
          customerId: rental.customerId,
          [`${path}.challengeId`]: challengeId,
          [`${path}.status`]: 'sent',
          [`${path}.expiresAt`]: { $gt: verifiedAt },
        },
        {
          $set: stageOnly
            ? {
                [type === 'pickup' ? 'pickupCustomerVerifiedAt' : 'returnOtpVerifiedAt']:
                  verifiedAt,
                [`${path}.status`]: 'customer_verified',
                [`${path}.verifiedAt`]: verifiedAt,
              }
            : {
                status: nextStatus[type],
                [timestampField]: verifiedAt,
                [actorField]: actor._id,
                [`${path}.status`]: 'verified',
                [`${path}.verifiedAt`]: verifiedAt,
              },
          $unset: { [`${path}.otpHash`]: 1, [`${path}.emailHash`]: 1 },
          $inc: { __v: 1 },
          $push: {
            statusHistory: {
              previousStatus: expectedStatus[type],
              status: stageOnly ? expectedStatus[type] : nextStatus[type],
              action: stageOnly ? `${type}.customer_verified` : `${type}.verified`,
              verificationId: challengeId,
              at: verifiedAt,
              by: actor._id,
              note: stageOnly
                ? 'Customer email verified. Physical handover or receipt awaits administrator confirmation.'
                : `${type === 'pickup' ? 'Pickup' : 'Return'} verified using the customer email code.`,
            },
          },
        },
        { returnDocument: 'after', session, runValidators: true },
      )
      if (!updated)
        throw failure(
          409,
          'VERIFICATION_CHANGED',
          'This code was already used or the rental changed. Refresh the dashboard.',
        )
      // Touch inventory in the same transaction so a racing request cannot use a pre-pickup snapshot.
      if (type === 'pickup' && !stageOnly)
        await Product.updateMany(
          { _id: { $in: rental.items.map((item) => item.productId) } },
          { $inc: { __v: 1 } },
          { session },
        )
      if (type === 'return' && !stageOnly)
        await Product.updateMany(
          { 'rentalSlots.requestId': rental._id },
          { $pull: { rentalSlots: { requestId: rental._id } } },
          { session },
        )
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: customerFlow ? 'rental.pickup.customer_verified' : `rental.${type}.verified`,
            entityType: 'rental_request',
            entityId: String(rental._id),
            summary: `${customerFlow ? 'Customer email' : type === 'pickup' ? 'Pickup' : 'Return'} verified for rental ${rental._id}. Verification ${challengeId}.`,
            ipAddress,
          },
        ],
        { session },
      )
    },
    { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
  )
  return {
    rental: updated.toObject(),
    message: stageOnly
      ? 'Email verified. The rental status stays unchanged until an administrator confirms physical handover or receipt.'
      : type === 'pickup'
        ? 'Pickup verified successfully. Rental is now active.'
        : 'Return verified successfully. Rental has been marked as returned.',
  }
}

function ensureProviderScope(rental, actor) {
  if (
    actor.role === 'rental_shop' &&
      (!rental || !rental.items.length || !rental.items.every((i) => String(i.providerId) === String(actor._id)))
  )
    throw failure(404, 'RENTAL_NOT_FOUND', 'This booking is outside your shop handover scope.')
}

export async function preparePickup({ rentalId, actor }) {
  validateContext(actor, rentalId, 'pickup')
  await requireTransactions()
  let customerId
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findById(rentalId).session(session)
    ensureProviderScope(rental, actor)
    if (
      !rental ||
      rental.status !== 'confirmed' ||
      rental.readyForPickupAt ||
      !['authorized', 'paid'].includes(rental.payment?.status) ||
      !rental.items.every((item) => item.decision === 'accepted')
    )
      throw failure(
        409,
        'PICKUP_NOT_READY',
        'Only paid, approved bookings not already prepared can be marked ready.',
      )
    rental.readyForPickupAt = new Date()
    customerId = rental.customerId
    rental.statusHistory.push({
      previousStatus: 'confirmed',
      status: 'confirmed',
      action: 'pickup.ready',
      by: actor._id,
      note: 'Administrator prepared the items and marked pickup ready.',
    })
    await rental.save({ session })
    const { identityNotification } = await import('../identity/identity.service.mjs')
    await identityNotification(
      rental.customerId,
      'Rental Ready for Pickup',
      'Your rental items are ready. Verify your pickup email in My rentals, then meet the administrator for physical handover.',
      'requests',
      session,
      rental._id,
    )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: 'rental.pickup.ready',
          entityType: 'rental_request',
          entityId: String(rentalId),
          summary: 'Marked paid, approved rental ready for pickup.',
        },
      ],
      { session },
    )
  })
  const { emailIdentityNotice } = await import('../identity/identity.service.mjs')
  await emailIdentityNotice(
    customerId,
    'Rental Ready for Pickup',
    'Your items are prepared. Open My rentals to verify your pickup email and arrange physical handover.',
  )
  return { message: 'Rental is ready for pickup.' }
}

export async function confirmReturnReceipt({ rentalId, actor, inspectionNote }) {
  validateContext(actor, rentalId, 'return')
  if (
    typeof inspectionNote !== 'string' ||
    inspectionNote.trim().length < 5 ||
    inspectionNote.trim().length > 1000
  )
    throw failure(
      400,
      'INSPECTION_REQUIRED',
      'Record the item inspection in 5–1000 characters before confirming receipt.',
    )
  await requireTransactions()
  let updated
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findById(rentalId)
      .select('+handover.return')
      .session(session)
    ensureProviderScope(rental, actor)
    assertHandoverEligible(rental, 'return')
    if (!rental.returnOtpVerifiedAt || rental.handover?.return?.status !== 'customer_verified')
      throw failure(
        409,
        'RETURN_NOT_VERIFIED',
        'Verify the return email code before confirming physical receipt.',
      )
    const now = new Date()
    updated = await RentalRequest.findOneAndUpdate(
      {
        _id: rentalId,
        status: 'active',
        __v: rental.__v,
        'handover.return.status': 'customer_verified',
      },
      {
        $set: {
          status: 'returned',
          returnVerifiedAt: now,
          returnVerifiedBy: actor._id,
          'handover.return.status': 'verified',
          returnInspection: {
            note: inspectionNote.trim(),
            inspectedAt: now,
            inspectedBy: actor._id,
          },
        },
        $inc: { __v: 1 },
        $push: {
          statusHistory: {
            previousStatus: 'active',
            status: 'returned',
            action: 'return.receipt_confirmed',
            by: actor._id,
            at: now,
            note: 'Physical receipt and inspection confirmed after email verification.',
          },
        },
      },
      { session, returnDocument: 'after', runValidators: true },
    )
    if (!updated)
      throw failure(409, 'VERIFICATION_CHANGED', 'This return changed. Refresh and try again.')
    await Product.updateMany(
      { 'rentalSlots.requestId': rental._id },
      { $pull: { rentalSlots: { requestId: rental._id } }, $inc: { __v: 1 } },
      { session },
    )
    const { identityNotification } = await import('../identity/identity.service.mjs')
    await identityNotification(
      rental.customerId,
      'Rental Return Confirmed',
      'Your items have been received and inspected. Review My rentals for payment and deposit updates.',
      'requests',
      session,
      rental._id,
    )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: 'rental.return.receipt_confirmed',
          entityType: 'rental_request',
          entityId: String(rentalId),
          summary: 'Confirmed physical receipt and recorded item inspection.',
        },
      ],
      { session },
    )
  })
  const { emailIdentityNotice } = await import('../identity/identity.service.mjs')
  await emailIdentityNotice(
    updated.customerId,
    'Rental Return Confirmed',
    'Your items were received and inspected. Review My rentals for payment and deposit details.',
  )
  return {
    message: 'Return receipt and inspection confirmed. Inventory is available again.',
    rental: updated.toObject(),
  }
}

export async function completeRental({ rentalId, actor }) {
  validateContext(actor, rentalId, 'return')
  await requireTransactions()
  let customerId
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findById(rentalId).session(session)
    ensureProviderScope(rental, actor)
    if (!rental || rental.status !== 'returned' || !rental.returnVerifiedAt)
      throw failure(409, 'RETURN_REQUIRED', 'A verified return is required before completion.')
    rental.status = 'completed'
    await DeliveryLocation.deleteMany({ rentalId: rental._id }, { session })
    customerId = rental.customerId
    rental.statusHistory.push({
      previousStatus: 'returned',
      status: 'completed',
      action: 'rental.completed',
      by: actor._id,
      note: 'Administrator completed the returned rental. Existing payment and deposit records are unchanged.',
    })
    await rental.save({ session })
    const { identityNotification } = await import('../identity/identity.service.mjs')
    await identityNotification(
      rental.customerId,
      'Rental Completed',
      'Your returned rental is complete. Payment and deposit records remain available in My rentals.',
      'requests',
      session,
      rental._id,
    )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: 'rental.completed',
          entityType: 'rental_request',
          entityId: String(rentalId),
          summary: 'Completed a physically returned rental without changing charges.',
        },
      ],
      { session },
    )
  })
  const { emailIdentityNotice } = await import('../identity/identity.service.mjs')
  await emailIdentityNotice(
    customerId,
    'Rental Completed',
    'Your returned rental is complete. Your rental history remains available.',
  )
  return { message: 'Rental completed.' }
}

export async function confirmPickupHandover({ rentalId, actor, ipAddress = '' }) {
  validateContext(actor, rentalId, 'pickup')
  await requireTransactions()
  let updated
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findById(rentalId)
      .select('+handover.pickup')
      .session(session)
    ensureProviderScope(rental, actor)
    assertHandoverEligible(rental, 'pickup')
    if (!rental.pickupCustomerVerifiedAt || rental.handover?.pickup?.status !== 'customer_verified')
      throw failure(
        409,
        'CUSTOMER_NOT_VERIFIED',
        'The customer must verify their email code before you confirm handover.',
      )
    const now = new Date()
    updated = await RentalRequest.findOneAndUpdate(
      {
        _id: rentalId,
        status: 'confirmed',
        __v: rental.__v,
        'handover.pickup.status': 'customer_verified',
      },
      {
        $set: {
          status: 'active',
          pickupVerifiedAt: now,
          pickupVerifiedBy: actor._id,
          'handover.pickup.status': 'verified',
        },
        $inc: { __v: 1 },
        $push: {
          statusHistory: {
            previousStatus: 'confirmed',
            status: 'active',
            action: 'pickup.handover_confirmed',
            at: now,
            by: actor._id,
            note: 'Administrator confirmed physical handover after customer email verification.',
          },
        },
      },
      { session, returnDocument: 'after', runValidators: true },
    )
    if (!updated)
      throw failure(
        409,
        'VERIFICATION_CHANGED',
        'This rental changed. Refresh before confirming handover.',
      )
    await Product.updateMany(
      { _id: { $in: rental.items.map((item) => item.productId) } },
      { $inc: { __v: 1 } },
      { session },
    )
    const { identityNotification } = await import('../identity/identity.service.mjs')
    await identityNotification(
      rental.customerId,
      'Rental Pickup Confirmed',
      'The administrator confirmed physical handover. Your rental is now on rental.',
      'requests',
      session,
      rental._id,
    )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: 'rental.pickup.handover_confirmed',
          entityType: 'rental_request',
          entityId: String(rentalId),
          summary: 'Physical pickup confirmed after customer email verification.',
          ipAddress,
        },
      ],
      { session },
    )
  })
  const { emailIdentityNotice } = await import('../identity/identity.service.mjs')
  await emailIdentityNotice(
    updated.customerId,
    'Rental Pickup Confirmed',
    'Physical handover has been confirmed. Your booking is now on rental.',
  )
  return {
    rental: updated.toObject(),
    message: 'Physical handover confirmed. Rental is now on rental.',
  }
}
