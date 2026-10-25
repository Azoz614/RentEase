import { Notification } from './notification.model.mjs'

export const listInbox = async (req, res) => {
  const notifications = await Notification.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
  res.json({ notifications })
}

export const markInboxRead = async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, readAt: null },
    { $set: { readAt: new Date() } },
  )
  res.json({ message: 'Mailbox marked as read.' })
}
