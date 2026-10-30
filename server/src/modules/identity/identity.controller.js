import { readIdentityPhoto } from './identity-documents.service.mjs'
import mongoose from 'mongoose'
import { IdentityVerification, IdentityDispute } from './identity.model.mjs'
import { User } from '../users/user.model.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { currentNotificationFilter } from '../notifications/handover-notifications.service.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import {
  customerIdentityView,
  submitCustomerIdentity,
  saveCustomerAddress,
  assertUniqueNic,
  identityNotification,
  emailIdentityNotice,
} from './identity.service.mjs'
import {
  identityError,
  identityRate,
  parseNic,
  decryptIdentity,
  confirmAccountPassword,
} from './identity-security.service.mjs'
import { requireTransactions } from '../../services/mongo-transactions.mjs'

export const getIdentityStatus = async (req, res) => res.json(await customerIdentityView(req.user))

export const getIdentityProfile = async (req, res) =>
  res.json(await customerIdentityView(req.user, { sensitive: true }))

export const checkNicAvailability = async (req, res) => {
  await identityRate(req.user._id, 'duplicate-check', 30)
  const nic = parseNic(req.body.nic)
  await assertUniqueNic(nic.digest, req.user._id)
  res.json({ available: true, message: 'This NIC can be submitted for administrator review.' })
}

export const submitIdentity = async (req, res) => {
  await identityRate(req.user._id, 'submit', 5)
  await submitCustomerIdentity({ actor: req.user, body: req.body, ipAddress: req.ip })
  res.status(201).json({
    message:
      'Your NIC verification is under review. You can request rentals after administrator approval.',
    status: 'pending',
  })
}

export const readCustomerDocument = async (req, res) =>
  sendDocument(req.user._id, req.params.side, res)

export const createIdentityDispute = async (req, res) => {
  await identityRate(req.user._id, 'dispute', 3)
  const nic = parseNic(req.body.nic),
    message = typeof req.body.message === 'string' ? req.body.message.trim() : ''
  if (message.length < 20 || message.length > 1000)
    throw identityError(
      400,
      'INVALID_DISPUTE',
      'Describe the issue in 20–1000 characters. Do not include passwords or document images.',
    )
  if (await IdentityDispute.exists({ userId: req.user._id, status: 'open' }))
    throw identityError(
      409,
      'DISPUTE_OPEN',
      'You already have an open identity claim. Support will review it.',
    )
  await IdentityDispute.create({ userId: req.user._id, nicDigest: nic.digest, message })
  const admins = await User.find({ role: 'admin', active: true }).select('_id')
  for (const admin of admins)
    await identityNotification(
      admin._id,
      'Identity Support Claim',
      'A customer has requested help with an identity registration conflict.',
      'verification',
    )
  res.status(201).json({
    message:
      'Your claim has been sent to authorized administrators. No account or identity ownership was disclosed.',
  })
}

export const listAddresses = async (req, res) => {
  const view = await customerIdentityView(req.user)
  const rentals = await RentalRequest.find({
    customerId: req.user._id,
    addressSnapshot: { $exists: true },
  })
    .select('addressSnapshot createdAt')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()
  res.json({
    addresses: view.addresses,
    defaultAddress: view.defaultAddress,
    previousRentalAddresses: rentals.map((rental) => ({
      address: rental.addressSnapshot,
      usedAt: rental.createdAt,
    })),
  })
}

export const createAddress = async (req, res) => {
  await saveCustomerAddress({ actor: req.user, body: req.body })
  res.status(201).json({ message: 'Address saved securely.' })
}

export const updateAddress = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw identityError(400, 'INVALID_ADDRESS', 'Choose a valid address.')
  await saveCustomerAddress({ actor: req.user, id: req.params.id, body: req.body })
  res.json({
    message:
      'Address updated securely. Your NIC approval and existing rental addresses are unchanged.',
  })
}

export const makeDefaultAddress = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw identityError(400, 'INVALID_ADDRESS', 'Choose a valid address.')
  await saveCustomerAddress({
    actor: req.user,
    id: req.params.id,
    body: req.body,
    makeDefaultOnly: true,
  })
  res.json({
    message: 'Default address changed securely. Existing rental addresses are unchanged.',
  })
}

export const updateNotification = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || typeof req.body.read !== 'boolean')
    throw identityError(400, 'INVALID_NOTIFICATION', 'Choose a notification and read status.')
  const notice = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id, ...currentNotificationFilter() },
    { $set: { readAt: req.body.read ? new Date() : null } },
    { returnDocument: 'after' },
  )
  if (!notice) throw identityError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.')
  res.json({ notification: notice })
}

export const listCustomerVerifications = async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending'
  if (
    !['all', 'pending', 'approved', 'rejected', 'resubmission_required', 'not_submitted'].includes(
      status,
    )
  )
    throw identityError(400, 'INVALID_STATUS', 'Choose a valid verification status.')
  const filter = status === 'all' ? {} : { status },
    q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
  if (q) {
    filter.$or = [{ fullName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }]
    if (mongoose.isValidObjectId(q)) filter.$or.push({ userId: new mongoose.Types.ObjectId(q) })
  }
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const [rows, total] = await Promise.all([
    IdentityVerification.find(filter)
      .select('userId fullName nicMasked status submittedAt reviewedAt revision reviewNote')
      .sort({ submittedAt: -1 })
      .skip((page - 1) * 20)
      .limit(20)
      .lean(),
    IdentityVerification.countDocuments(filter),
  ])
  res.json({ verifications: rows, total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}

export const listIdentityDisputes = async (_req, res) => {
  const disputes = await IdentityDispute.find({ status: 'open' })
    .select('-nicDigest')
    .sort({ createdAt: 1 })
    .limit(100)
    .lean()
  res.json({ disputes })
}

export const resolveIdentityDispute = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw identityError(400, 'INVALID_DISPUTE', 'Choose a valid claim.')
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
  if (reason.length < 10 || reason.length > 500)
    throw identityError(
      400,
      'REASON_REQUIRED',
      'Record your investigation and recovery instructions in 10–500 characters.',
    )
  await confirmAccountPassword(req.user, req.body.password)
  await requireTransactions()
  let claim
  await mongoose.connection.transaction(async (session) => {
    claim = await IdentityDispute.findOne({ _id: req.params.id, status: 'open' })
      .select('+nicDigest')
      .session(session)
    if (!claim || String(claim.userId) === String(req.user._id))
      throw identityError(
        409,
        'CLAIM_UNAVAILABLE',
        'This claim cannot be resolved by this administrator.',
      )
    // Release is optional and only after a manual investigation; it never approves the claimant.
    if (req.body.releaseExistingClaim === true) {
      const holder = await IdentityVerification.findOne({ nicDigest: claim.nicDigest }).session(
        session,
      )
      if (!holder)
        throw identityError(
          409,
          'CLAIM_UNAVAILABLE',
          'No identity claim can be released. Review the legacy migration or resolve without release.',
        )
      if (String(holder.userId) === String(req.user._id))
        throw identityError(403, 'SELF_REVIEW', 'You cannot release your own identity claim.')
      if (
        await RentalRequest.exists({
          customerId: holder.userId,
          status: { $in: ['pending', 'confirmed', 'active', 'disputed'] },
        }).session(session)
      )
        throw identityError(
          409,
          'OPEN_RENTALS',
          'Resolve outstanding rentals before releasing an identity claim.',
        )
      const previousStatus = holder.status
      holder.nicDigest = undefined
      holder.status = 'resubmission_required'
      holder.reviewNote = 'Your identity claim needs a new review. Contact support.'
      holder.history.push({
        previousStatus,
        status: holder.status,
        reason: 'Administrative identity-claim recovery; fresh review required.',
        by: req.user._id,
      })
      await holder.save({ session })
      await User.updateOne(
        { _id: holder.userId },
        { $set: { identityStatus: 'resubmission_required' }, $inc: { __v: 1 } },
        { session },
      )
      await identityNotification(
        holder.userId,
        'Identity Verification Update Required',
        "Additional information is required to verify your NIC. Please open your profile and review the administrator's instructions.",
        'verification',
        session,
      )
    }
    claim.status = 'resolved'
    claim.resolution = reason
    claim.resolvedBy = req.user._id
    claim.resolvedAt = new Date()
    await claim.save({ session })
    await identityNotification(
      claim.userId,
      'Identity Support Claim Updated',
      reason,
      'verification',
      session,
    )
    await AuditLog.create(
      [
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: 'identity.dispute.resolved',
          entityType: 'identity_dispute',
          entityId: String(claim._id),
          summary: req.body.releaseExistingClaim
            ? 'Investigated claim and released a reservation for fresh verification; no automatic approval.'
            : 'Recorded identity dispute investigation and recovery instructions.',
        },
      ],
      { session },
    )
  })
  await emailIdentityNotice(
    claim.userId,
    'Identity Support Claim Updated',
    'An administrator reviewed your support claim. Open identity verification to read the recovery instructions.',
  )
  res.json({
    message: 'Claim resolved. The customer must still complete normal identity approval.',
  })
}

export const getCustomerVerification = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw identityError(400, 'INVALID_IDENTITY', 'Choose a valid verification.')
  const identity = await IdentityVerification.findById(req.params.id)
    .select('+nicEncrypted +front +back')
    .lean()
  if (!identity) throw identityError(404, 'IDENTITY_NOT_FOUND', 'Verification not found.')
  await AuditLog.create({
    actorId: req.user._id,
    actorRole: req.user.role,
    action: 'identity.details.viewed',
    entityType: 'identity_verification',
    entityId: String(identity._id),
    summary: 'Authorized administrator opened sensitive identity details.',
    ipAddress: req.ip,
  })
  const { nicEncrypted, front, back, ...safe } = identity
  res.json({
    verification: {
      ...safe,
      nic: nicEncrypted ? decryptIdentity(nicEncrypted, `${identity.userId}:nic`).toString() : '',
      hasFront: Boolean(front),
      hasBack: Boolean(back),
    },
  })
}

export const readVerificationDocument = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw identityError(400, 'INVALID_IDENTITY', 'Choose a valid verification.')
  const identity = await IdentityVerification.findById(req.params.id).select('userId')
  if (!identity) throw identityError(404, 'IDENTITY_NOT_FOUND', 'Verification not found.')
  await AuditLog.create({
    actorId: req.user._id,
    actorRole: req.user.role,
    action: 'identity.document.viewed',
    entityType: 'identity_verification',
    entityId: String(identity._id),
    summary: 'Authorized administrator viewed a private identity document.',
    ipAddress: req.ip,
  })
  await sendDocument(identity.userId, req.params.side, res)
}

export const decideVerification = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw identityError(400, 'INVALID_IDENTITY', 'Choose a valid verification.')
  const { decision, revision } = req.body,
    reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
  if (
    !['approved', 'rejected', 'resubmission_required'].includes(decision) ||
    !Number.isInteger(revision)
  )
    throw identityError(
      400,
      'INVALID_DECISION',
      'Choose a decision using the latest submission revision.',
    )
  if (reason.length > 500 || (decision !== 'approved' && reason.length < 5))
    throw identityError(
      400,
      'REASON_REQUIRED',
      'A specific reason of 5–500 characters is required for rejection or resubmission; all notes must be at most 500 characters.',
    )
  await requireTransactions()
  const titles = {
    approved: 'Identity Verification Approved',
    rejected: 'Identity Verification Rejected',
    resubmission_required: 'Identity Verification Update Required',
  }
  const messages = {
    approved:
      'Your NIC verification has been approved successfully. You can now request rental items.',
    rejected:
      'Your NIC verification could not be approved. Please review the feedback and submit corrected information.',
    resubmission_required:
      "Additional information is required to verify your NIC. Please open your profile and review the administrator's instructions.",
  }
  let identity
  await mongoose.connection.transaction(async (session) => {
    identity = await IdentityVerification.findOne({
      _id: req.params.id,
      status: 'pending',
      revision,
    })
      .select('+front +back +nicDigest')
      .session(session)
    if (!identity)
      throw identityError(
        409,
        'REVIEW_CHANGED',
        'This submission has already been reviewed or changed. Refresh the queue.',
      )
    if (String(identity.userId) === String(req.user._id))
      throw identityError(403, 'SELF_REVIEW', 'Administrators cannot review their own identity.')
    if (
      decision === 'approved' &&
      (!identity.front ||
        !identity.back ||
        !identity.nicDigest ||
        !identity.address?.line1 ||
        !identity.consentAt)
    )
      throw identityError(
        409,
        'IDENTITY_INCOMPLETE',
        'This identity is incomplete. Request resubmission instead.',
      )
    identity.status = decision
    identity.reviewedBy = req.user._id
    identity.reviewedAt = new Date()
    identity.reviewNote = reason
    identity.retentionUntil = new Date(
      Date.now() + Number(process.env.IDENTITY_RETENTION_DAYS || 365) * 86400000,
    )
    identity.history.push({
      previousStatus: 'pending',
      status: decision,
      reason,
      at: identity.reviewedAt,
      by: req.user._id,
    })
    await identity.save({ session })
    await User.updateOne(
      { _id: identity.userId },
      { $set: { identityStatus: decision, identityReviewNote: reason }, $inc: { __v: 1 } },
      { session },
    )
    await identityNotification(
      identity.userId,
      titles[decision],
      messages[decision],
      'verification',
      session,
    )
    await AuditLog.create(
      [
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: `identity.${decision}`,
          entityType: 'identity_verification',
          entityId: String(identity._id),
          summary: `Recorded administrator identity decision: ${decision}.`,
          ipAddress: req.ip,
        },
      ],
      { session },
    )
  })
  await emailIdentityNotice(identity.userId, titles[decision], messages[decision])
  res.json({ message: titles[decision], status: decision })
}

async function sendDocument(userId, side, res) {
  if (!['front', 'back'].includes(side))
    throw identityError(400, 'INVALID_DOCUMENT', 'Choose the front or back document.')
  const identity = await IdentityVerification.findOne({ userId }).select(`+${side}`)
  const buffer = await readIdentityPhoto(identity?.[side], userId, side)
  res
    .set({
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    .send(buffer)
}
