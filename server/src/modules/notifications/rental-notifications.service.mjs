import { Notification } from './notification.model.mjs'
import { sendRentalNotice, sendRentalSms } from '../../config/mailer.js'

export async function notify(user, requestId, title, body, persist = true) {
  if (!user) return
  try {
    if (persist) await Notification.create({ userId: user._id, requestId, title, body })
  } catch (error) {
    console.error('Could not save in-app rental notification:', error.message)
  }
  sendRentalNotice(user.email, title, body).catch((error) =>
    console.error('Rental email notification failed:', error.message),
  )
  sendRentalSms(user.phone, title, body).catch((error) =>
    console.error('Rental SMS notification failed:', error.message),
  )
}
