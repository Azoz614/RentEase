import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  actorRole: { type: String, required: true, index: true },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, default: '' },
  summary: { type: String, required: true, maxlength: 500 },
  ipAddress: { type: String, default: '' },
}, { timestamps: true })

auditLogSchema.index({ createdAt: -1 })
export const AuditLog = mongoose.model('AuditLog', auditLogSchema)
