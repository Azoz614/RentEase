import { Notification } from './notification.model.mjs'
import mongoose from 'mongoose'
import { currentNotificationFilter } from './handover-notifications.service.mjs'

export const listInbox = async (req, res) => {
  const scope = { userId: req.user._id, ...currentNotificationFilter() }
  const filter = req.query.filter
  if (filter && !['all', 'read', 'unread'].includes(filter))
    return res.status(400).json({ message: 'Choose All, Unread, or Read notifications.' })
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100))
  const offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0))
  const query = { ...scope, ...(filter === 'unread' ? { readAt: null } : filter === 'read' ? { readAt: { $ne: null } } : {}) }
  const [notifications, unreadCount, total] = await Promise.all([Notification.find(query)
    .sort({ createdAt: -1 })
    .skip(offset).limit(limit).lean(), Notification.countDocuments({ ...scope, readAt: null }), Notification.countDocuments(query)])
  res.set('Cache-Control', 'private, no-store')
  res.json({ notifications, unreadCount, total, hasMore: offset + notifications.length < total })
}

export const markInboxRead = async (req, res) => {
  const ids = req.body?.ids
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => !mongoose.isValidObjectId(id))))
    return res.status(400).json({ message: 'Choose valid notifications to mark as read.' })
  await Notification.updateMany(
    { userId: req.user._id, readAt: null, ...currentNotificationFilter(), ...(ids && { _id: { $in: ids } }) },
    { $set: { readAt: new Date() } },
  )
  res.json({ message: 'Mailbox marked as read.' })
}
