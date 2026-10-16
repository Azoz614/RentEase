import { AuditLog } from '../model/auditLog.mjs'

export function recordAudit(req, { action, entityType, entityId = '', summary }) {
  const actor = req.user
  if (!actor) return
  AuditLog.create({ actorId: actor._id, actorRole: actor.role, action, entityType, entityId: String(entityId || ''), summary, ipAddress: req.ip || '' })
    .catch((error) => console.error('Could not save audit event:', error.message))
}
