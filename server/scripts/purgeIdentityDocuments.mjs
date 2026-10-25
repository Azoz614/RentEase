import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import { IdentityVerification } from '../src/modules/identity/identity.model.mjs'
import { removeIdentityPhotos } from '../src/modules/identity/identity-documents.service.mjs'
import { AuditLog } from '../src/modules/admin/audit-log.model.mjs'

export async function purgeIdentityDocuments({ apply = false } = {}) {
  const filter = {
    status: { $in: ['approved', 'rejected', 'resubmission_required'] },
    retentionUntil: { $lte: new Date() },
    documentsDeletedAt: null,
  }
  const records = await IdentityVerification.find(filter).select('+front +back').lean()
  if (!apply)
    return {
      mode: 'dry-run',
      expiredSubmissions: records.length,
      scope:
        'Only expired v2 identity photos; pending submissions, NIC duplicate claims, rental records and decision history are preserved.',
    }
  let purged = 0
  for (const record of records) {
    await removeIdentityPhotos([record.front, record.back], { strict: true })
    const updated = await IdentityVerification.updateOne(
      { ...filter, _id: record._id, revision: record.revision },
      {
        $set: { documentsDeletedAt: new Date() },
        $unset: { 'front.filename': 1, 'back.filename': 1 },
        $inc: { __v: 1 },
      },
    )
    if (!updated.modifiedCount) continue
    await AuditLog.create({
      actorRole: 'maintenance',
      action: 'identity.documents.retained_period_expired',
      entityType: 'identity_verification',
      entityId: String(record._id),
      summary:
        'Removed expired private photo objects. Approval history and duplicate-prevention claim retained.',
    })
    purged += 1
  }
  return { mode: 'apply', purged }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config')
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    console.log(
      JSON.stringify(
        await purgeIdentityDocuments({ apply: process.argv.includes('--apply') }),
        null,
        2,
      ),
    )
  } catch (error) {
    console.error(
      `Document retention maintenance failed (${error.name}). Check private storage and database permissions.`,
    )
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}
