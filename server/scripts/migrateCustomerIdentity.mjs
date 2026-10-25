import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import { User } from '../src/modules/users/user.model.mjs'
import { IdentityVerification } from '../src/modules/identity/identity.model.mjs'
import {
  identityKey,
  parseNic,
  encryptIdentity,
} from '../src/modules/identity/identity-security.service.mjs'

export async function migrateCustomerIdentity({ apply = false } = {}) {
  const users = await User.find({
    $or: [{ role: 'user' }, { role: { $exists: false } }, { role: null }],
  })
    .select('+nic +identityFrontPath +identityBackPath')
    .lean()
  const existing = await IdentityVerification.find().select('userId +nicDigest').lean()
  const existingUsers = new Set(existing.map((record) => String(record.userId)))
  let configured = true
  try {
    identityKey('IDENTITY_ENCRYPTION_KEY')
    identityKey('IDENTITY_HASH_KEY')
  } catch {
    configured = false
  }
  const candidates = users.filter(
    (user) =>
      !existingUsers.has(String(user._id)) &&
      (user.nic ||
        user.identityStatus !== 'not_submitted' ||
        user.identityFrontPath ||
        user.identityBackPath),
  )
  const parsed = new Map(),
    claims = new Map(
      existing
        .filter((record) => record.nicDigest)
        .map((record) => [record.nicDigest, [String(record.userId)]]),
    )
  let invalidNicCount = 0
  if (configured)
    for (const user of users) {
      if (!user.nic) continue
      try {
        const nic = parseNic(user.nic)
        parsed.set(String(user._id), nic)
        claims.set(nic.digest, [...new Set([...(claims.get(nic.digest) || []), String(user._id)])])
      } catch {
        invalidNicCount += 1
      }
    }
  const duplicates = [...claims.values()].filter((ids) => ids.length > 1)
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    securityKeysConfigured: configured,
    customersInspected: users.length,
    recordsRequiringSecureResubmission: candidates.length,
    invalidNicCount,
    duplicateGroups: duplicates.length,
    legacyFilesPreserved: true,
    note: 'No identity is approved automatically. No legal name, birth date or structured address is fabricated. Original rental snapshots are unchanged.',
  }
  if (!apply) return report
  if (!configured)
    throw new Error('Configure both identity encryption/hash keys before applying this migration.')
  if (duplicates.length)
    throw new Error(
      'Duplicate normalized NIC groups detected. Resolve ownership with support before applying; no changes were made.',
    )
  await IdentityVerification.createIndexes()
  let modified = 0
  for (const user of candidates) {
    const nic = parsed.get(String(user._id))
    // A conditional per-account transaction makes repeated migration runs safe.
    await mongoose.connection.transaction(async (session) => {
      if (await IdentityVerification.exists({ userId: user._id }).session(session)) return
      const now = new Date()
      await IdentityVerification.create(
        [
          {
            userId: user._id,
            fullName: user.username,
            phone: user.phone,
            email: user.email,
            ...(nic
              ? {
                  nicDigest: nic.digest,
                  nicEncrypted: encryptIdentity(
                    Buffer.from(nic.normalized),
                    `${user._id}:nic`,
                  ).toString('base64'),
                  nicMasked: nic.masked,
                }
              : {}),
            status: 'resubmission_required',
            reviewNote:
              'Complete the secure verification form with legal name, birth date, new card photos and a complete residential address. Previous flags alone do not grant rental eligibility.',
            revision: 0,
            history: [
              {
                previousStatus: user.identityStatus || 'not_submitted',
                status: 'resubmission_required',
                at: now,
                reason:
                  'Migrated legacy profile to secure resubmission. No administrator approval was fabricated.',
              },
            ],
          },
        ],
        { session },
      )
      await User.updateOne(
        { _id: user._id },
        { $set: { identityStatus: 'resubmission_required' }, $unset: { nic: 1 }, $inc: { __v: 1 } },
        { session },
      )
      modified += 1
    })
  }
  return { ...report, modified }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config')
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      autoCreate: false,
      autoIndex: false,
    })
    console.log(
      JSON.stringify(
        await migrateCustomerIdentity({ apply: process.argv.includes('--apply') }),
        null,
        2,
      ),
    )
  } catch (error) {
    console.error(
      `Identity migration unavailable (${error.name}). Check MongoDB replica-set connectivity, keys and duplicate claims. No secrets or identity values are logged.`,
    )
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}
