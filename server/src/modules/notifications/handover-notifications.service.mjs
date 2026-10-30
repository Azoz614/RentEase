import { Notification } from './notification.model.mjs'

// Codes exist only in the recipient's private inbox, never in shared job updates.
export async function publishHandoverOtp({ recipientId, rentalId, taskId, challengeId, code, stage, expiresAt }, session) {
  await Notification.updateOne(
    { userId: recipientId, requestId: rentalId, type: 'handover_otp',
      ...(taskId ? { deliveryTaskId: taskId } : { deliveryTaskId: { $exists: false } }) },
    { $set: { title: 'Your handover code',
      body: `Your ${stage.replaceAll('_', ' ')} code is ${code}. Share it with the person handing over the items only after receiving them. Expires in 5 minutes.`,
      handoverChallengeId: challengeId, expiresAt, readAt: null, link: 'requests', createdAt: new Date() } },
    { upsert: true, runValidators: true, session },
  )
}

export async function removeHandoverOtp(challengeId, session) {
  await Notification.deleteMany({ handoverChallengeId: challengeId }, { session })
}

export const currentNotificationFilter = () => ({
  $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
})
