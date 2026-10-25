import mongoose from 'mongoose'
import { point, latLng } from '../maps/location.service.mjs'
import { User } from '../users/user.model.mjs'
import { IdentityVerification } from './identity.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'

import { sendRentalNotice } from '../../config/mailer.js'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import {
  confirmAccountPassword,
  identityError,
  parseNic,
  encryptIdentity,
  decryptIdentity,
  DUPLICATE_NIC,
} from './identity-security.service.mjs'
import {
  prepareIdentityPhoto,
  storeIdentityPhoto,
  removeIdentityPhotos,
} from './identity-documents.service.mjs'
import { geoapifyKey, geoapifyRequest } from '../maps/geoapify.service.mjs'

export const INCOMPLETE_IDENTITY =
  'Please complete your NIC verification and residential address before requesting a rental.'
export const PENDING_IDENTITY =
  'Your NIC verification is under review. You can request rentals after administrator approval.'
export const formatAddress = (address) =>
  [
    address.line1,
    address.line2,
    address.city,
    address.district,
    address.province,
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(', ')
async function geocodeAddress(address) {
  if (address.location) return latLng(address.location)
  if (!geoapifyKey()) return null
  try {
    const result = await geoapifyRequest('geocode/search', {
      text: formatAddress(address),
      filter: 'countrycode:lk',
      format: 'json',
      lang: 'en',
      limit: 1,
    })
    const candidate = result.results?.[0]
    // A town-level match is not an exact delivery address. Ask the customer to pin it.
    if (!['building', 'amenity'].includes(candidate?.result_type)) return null
    return latLng(point({ latitude: candidate.lat, longitude: candidate.lon }))
  } catch {
    return null
  }
}
export function validateAddress(value) {
  if (!value || typeof value !== 'object')
    throw identityError(400, 'ADDRESS_INCOMPLETE', 'Enter a complete residential address.')
  const result = {}
  for (const [field, min, max] of [
    ['line1', 3, 150],
    ['line2', 0, 150],
    ['city', 2, 80],
    ['district', 2, 80],
    ['province', 2, 80],
    ['postalCode', 0, 12],
    ['country', 2, 60],
  ]) {
    const text =
      typeof value[field] === 'string'
        ? value[field].trim()
        : field === 'country'
          ? 'Sri Lanka'
          : ''
    if (text.length < min || text.length > max || /[\x00-\x1f<>]/.test(text))
      throw identityError(
        400,
        'ADDRESS_INCOMPLETE',
        `Enter a valid ${field.replace('line', 'address line ')}.`,
      )
    result[field] = text
  }
  if (result.country !== 'Sri Lanka')
    throw identityError(
      400,
      'ADDRESS_COUNTRY',
      'This service currently supports residential addresses in Sri Lanka.',
    )
  if (result.postalCode && !/^\d{5}$/.test(result.postalCode))
    throw identityError(
      400,
      'ADDRESS_INCOMPLETE',
      'Sri Lankan postal codes must contain five digits, or leave blank if not applicable.',
    )
  if (value.location !== undefined) result.location = point(value.location)
  return result
}
export function defaultAddress(user) {
  return (
    user.addresses?.find((address) => String(address._id) === String(user.defaultAddressId)) || null
  )
}
export async function identityNotification(
  userId,
  title,
  body,
  link = 'verification',
  session,
  requestId,
) {
  await Notification.create(
    [
      {
        userId,
        title,
        body,
        type: link === 'requests' ? 'rental' : 'identity',
        link,
        ...(requestId ? { requestId } : {}),
      },
    ],
    session ? { session } : {},
  )
}
export async function emailIdentityNotice(userId, title, body) {
  try {
    const user = await User.findById(userId).select('email')
    if (user) await sendRentalNotice(user.email, title, body)
  } catch (error) {
    console.error('Identity notification email failed:', error.name)
  }
}
export async function assertUniqueNic(digest, userId, session) {
  const query = IdentityVerification.findOne({ nicDigest: digest, userId: { $ne: userId } }).select(
    '_id',
  )
  if (session) query.session(session)
  if (await query) throw identityError(409, 'DUPLICATE_NIC', DUPLICATE_NIC)
  // Legacy records must be migrated before new identity claims can be accepted safely.
  const legacyQuery = User.find({
    _id: { $ne: userId },
    $or: [{ role: 'user' }, { role: { $exists: false } }, { role: null }],
    nic: { $nin: ['', null] },
  }).select('+nic')
  if (session) legacyQuery.session(session)
  for (const user of await legacyQuery) {
    try {
      if (parseNic(user.nic).digest === digest)
        throw identityError(409, 'DUPLICATE_NIC', DUPLICATE_NIC)
    } catch (error) {
      if (error.code === 'DUPLICATE_NIC') throw error
    }
  }
}
export async function customerIdentityView(user, { sensitive = false } = {}) {
  const query = IdentityVerification.findOne({ userId: user._id })
  if (sensitive) query.select('+nicEncrypted')
  const identity = await query.lean()
  const address = defaultAddress(user)
  let deliveryLocation = address?.location
  if (!deliveryLocation && user.addressLocation) {
    try {
      deliveryLocation = point(user.addressLocation)
    } catch {
      /* Customers without valid saved coordinates can choose a pin at checkout. */
    }
  }
  const complete = Boolean(
    identity?.fullName && identity?.dateOfBirth && identity?.phone && address,
  )
  const status =
    identity?.status ||
    (['pending', 'approved'].includes(user.identityStatus)
      ? 'resubmission_required'
      : user.identityStatus) ||
    'not_submitted'
  return {
    status,
    stage: status === 'not_submitted' && !complete ? 'profile_incomplete' : status,
    profileComplete: complete,
    eligible: Boolean(user.active && status === 'approved' && complete),
    maskedNic: identity?.nicMasked || '',
    fullName: identity?.fullName || user.username,
    dateOfBirth: identity?.dateOfBirth || '',
    phone: user.phone,
    email: user.email,
    submittedAt: identity?.submittedAt || null,
    reviewNote:
      identity?.reviewNote ||
      (status === 'resubmission_required'
        ? 'Complete the secure verification form so an administrator can review your identity.'
        : ''),
    revision: identity?.revision || 0,
    history: (identity?.history || []).map(({ previousStatus, status: value, reason, at }) => ({
      previousStatus,
      status: value,
      reason,
      at,
    })),
    addresses: (user.addresses || []).map((entry) => ({
      ...(entry.toObject?.() || entry),
      ...(String(entry._id) === String(user.defaultAddressId) && !entry.location && deliveryLocation
        ? { location: deliveryLocation }
        : {}),
      isDefault: String(entry._id) === String(user.defaultAddressId),
    })),
    defaultAddress: address
      ? {
          ...(address.toObject?.() || address),
          ...(deliveryLocation ? { location: deliveryLocation } : {}),
        }
      : address,
    ...(sensitive && identity?.nicEncrypted
      ? { nic: decryptIdentity(identity.nicEncrypted, `${user._id}:nic`).toString() }
      : {}),
    message:
      status === 'pending'
        ? PENDING_IDENTITY
        : status === 'approved' && complete
          ? 'Identity Verified'
          : INCOMPLETE_IDENTITY,
  }
}
export async function assertRentalEligible(userId, session) {
  const userQuery = User.findById(userId),
    identityQuery = IdentityVerification.findOne({ userId }).select('+nicDigest +front +back')
  if (session) {
    userQuery.session(session)
    identityQuery.session(session)
  }
  // A MongoDB session must not run parallel operations inside a transaction.
  const user = await userQuery
  const identity = await identityQuery
  if (!user?.active || user.role !== 'user')
    throw identityError(
      403,
      'ACCOUNT_INELIGIBLE',
      'This account is not eligible to request rentals.',
    )
  if (identity?.status === 'pending') throw identityError(403, 'IDENTITY_PENDING', PENDING_IDENTITY)
  if (['rejected', 'resubmission_required'].includes(identity?.status))
    throw identityError(
      403,
      'IDENTITY_REJECTED',
      `${INCOMPLETE_IDENTITY} ${identity.reviewNote || 'Review the administrator feedback and resubmit.'}`,
    )
  const address = defaultAddress(user)
  if (
    !identity ||
    identity.status !== 'approved' ||
    !identity.nicDigest ||
    !identity.fullName ||
    !identity.dateOfBirth ||
    !identity.front ||
    !identity.back ||
    !identity.consentAt ||
    !address ||
    !user.email ||
    !user.phone
  )
    throw identityError(403, 'IDENTITY_REQUIRED', INCOMPLETE_IDENTITY)
  validateAddress(address.toObject())
  return { user, identity, address: validateAddress(address.toObject()) }
}

export async function submitCustomerIdentity({ actor, body, ipAddress = '' }) {
  if (actor.role !== 'user')
    throw identityError(403, 'CUSTOMER_REQUIRED', 'Customer access is required.')
  const nic = parseNic(body.nic, body.dateOfBirth)
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '',
    phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (fullName.length < 3 || fullName.length > 120 || /[<>\x00-\x1f]/.test(fullName))
    throw identityError(
      400,
      'INVALID_NAME',
      'Enter your full legal name, between 3 and 120 characters.',
    )
  if (!/^[+\d() .-]{7,24}$/.test(phone))
    throw identityError(400, 'INVALID_PHONE', 'Enter a valid contact phone number.')
  if (body.consent !== true)
    throw identityError(
      400,
      'CONSENT_REQUIRED',
      'Confirm that the information is accurate and may be used for identity verification.',
    )
  const address = validateAddress(body.address)
  await confirmAccountPassword(actor, body.password)
  await requireTransactions()
  await assertUniqueNic(nic.digest, actor._id)
  const location = await geocodeAddress(address)
  if (location && !address.location) address.location = point(location)
  const buffers = await Promise.all([
    prepareIdentityPhoto(body.front),
    prepareIdentityPhoto(body.back),
  ])
  const files = []
  let previousFiles = [],
    result
  try {
    files.push(await storeIdentityPhoto(buffers[0], actor._id, 'front'))
    files.push(await storeIdentityPhoto(buffers[1], actor._id, 'back'))
    await mongoose.connection.transaction(async (session) => {
      const user = await User.findById(actor._id).session(session)
      const previous = await IdentityVerification.findOne({ userId: actor._id })
        .select('+front +back')
        .session(session)
      if (['approved', 'pending'].includes(previous?.status))
        throw identityError(
          409,
          'IDENTITY_LOCKED',
          'Your identity is already approved or under review. Contact support to request a correction.',
        )
      await assertUniqueNic(nic.digest, actor._id, session)
      const now = new Date(),
        newAddress = {
          ...address,
          _id: new mongoose.Types.ObjectId(),
          createdAt: now,
          updatedAt: now,
        }
      const currentAddress = defaultAddress(user)
      if (
        !currentAddress ||
        JSON.stringify(validateAddress(currentAddress.toObject())) !== JSON.stringify(address)
      ) {
        if ((user.addresses?.length || 0) >= 20)
          throw identityError(
            409,
            'ADDRESS_LIMIT',
            'Your address book is full. Edit an existing address first.',
          )
        user.addresses.push(newAddress)
        user.defaultAddressId = newAddress._id
      }
      user.defaultAddress = formatAddress(address)
      user.phone = phone
      user.identityStatus = 'pending'
      user.nic = ''
      user.identityReviewNote = ''
      user.addressLocation = location || undefined
      await user.save({ session })
      previousFiles = [previous?.front, previous?.back]
      const fields = {
        fullName,
        dateOfBirth: body.dateOfBirth,
        phone,
        email: user.email,
        address,
        nicDigest: nic.digest,
        nicEncrypted: encryptIdentity(Buffer.from(nic.normalized), `${actor._id}:nic`).toString(
          'base64',
        ),
        nicMasked: nic.masked,
        front: files[0],
        back: files[1],
        status: 'pending',
        submittedAt: now,
        consentAt: now,
        reviewNote: '',
        reviewedAt: null,
        reviewedBy: null,
        documentsDeletedAt: null,
        retentionUntil: null,
      }
      if (previous) {
        const previousStatus = previous.status
        Object.assign(previous, fields)
        previous.revision += 1
        previous.history.push({
          previousStatus,
          status: 'pending',
          by: actor._id,
          at: now,
          reason: 'Customer submitted identity for review.',
        })
        await previous.save({ session })
        result = previous
      } else
        result = (
          await IdentityVerification.create(
            [
              {
                userId: actor._id,
                ...fields,
                revision: 1,
                history: [
                  { previousStatus: 'not_submitted', status: 'pending', by: actor._id, at: now },
                ],
              },
            ],
            { session },
          )
        )[0]
      const admins = await User.find({ role: 'admin', active: true }).select('_id').session(session)
      for (const admin of admins)
        await identityNotification(
          admin._id,
          'Customer Verification Submitted',
          'A customer identity submission is ready for administrator review.',
          'verification',
          session,
        )
      await identityNotification(
        actor._id,
        'Identity Verification Submitted',
        PENDING_IDENTITY,
        'verification',
        session,
      )
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'identity.submitted',
            entityType: 'identity_verification',
            entityId: String(result._id),
            summary: 'Submitted private identity documents and residential address for review.',
            ipAddress,
          },
        ],
        { session },
      )
    })
  } catch (error) {
    await removeIdentityPhotos(files)
    if (error.code === 11000) throw identityError(409, 'DUPLICATE_NIC', DUPLICATE_NIC)
    throw error
  }
  await removeIdentityPhotos(previousFiles)
  await emailIdentityNotice(actor._id, 'Identity Verification Submitted', PENDING_IDENTITY)
  return result
}

export async function saveCustomerAddress({ actor, id, body, makeDefaultOnly = false }) {
  await confirmAccountPassword(actor, body.password)
  await requireTransactions()
  const candidate = makeDefaultOnly ? actor.addresses.id(id) : validateAddress(body.address)
  if (!candidate) throw identityError(404, 'ADDRESS_NOT_FOUND', 'Address not found.')
  const location = await geocodeAddress(candidate)
  let saved
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findById(actor._id).session(session)
    const now = new Date(),
      address = id ? user.addresses.id(id) : null
    if (id && !address) throw identityError(404, 'ADDRESS_NOT_FOUND', 'Address not found.')
    if (!id && user.addresses.length >= 20)
      throw identityError(409, 'ADDRESS_LIMIT', 'You can save up to 20 addresses.')
    if (!makeDefaultOnly) {
      const validated = validateAddress(body.address)
      if (location && !validated.location) validated.location = point(location)
      if (address) {
        Object.assign(address, validated)
        address.location = validated.location
        address.updatedAt = now
        saved = address
      } else {
        user.addresses.push({ ...validated, createdAt: now, updatedAt: now })
        saved = user.addresses.at(-1)
      }
    } else {
      saved = address
      if (location && !saved.location) saved.location = point(location)
    }
    if (
      body.isDefault === true ||
      makeDefaultOnly ||
      !user.defaultAddressId ||
      String(user.defaultAddressId) === String(saved._id)
    ) {
      user.defaultAddressId = saved._id
      user.defaultAddress = formatAddress(saved)
      user.addressLocation = location || undefined
    }
    await user.save({ session })
    await identityNotification(
      actor._id,
      'Residential Address Updated',
      'Your saved residential address was changed after password confirmation. Contact support if this was not you.',
      'addresses',
      session,
    )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: 'address.updated',
          entityType: 'user',
          entityId: String(actor._id),
          summary:
            'Updated the address book after password reauthentication. Existing rental address snapshots were not changed.',
        },
      ],
      { session },
    )
  })
  await emailIdentityNotice(
    actor._id,
    'Residential Address Updated',
    'Your residential address was updated. Existing rental delivery addresses have not changed.',
  )
  return saved
}
