import { IdentityVerification } from './identity.model.mjs'
import { removeIdentityPhotos } from './identity-documents.service.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'

// Shared by `npm run identity:retention` and the Cloudflare Worker's daily cron.
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
