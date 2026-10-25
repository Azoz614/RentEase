import mongoose from 'mongoose'
import { DeliveryTask } from '../modules/delivery/delivery-task.model.mjs'
import { PartnerPresence } from '../modules/delivery/partner-presence.model.mjs'
import { Notification } from '../modules/notifications/notification.model.mjs'

export async function connectDB() {
  if (!process.env.MONGO_URI)
    throw new Error('Set MONGO_URI in server/.env before starting RentEase.')
  await mongoose.connect(process.env.MONGO_URI)
  await Promise.all([DeliveryTask.init(), PartnerPresence.init(), Notification.init()])
  console.log('Connected to MongoDB')
  const hello = await mongoose.connection.db.admin().command({ hello: 1 })
  if (hello.setName || hello.msg === 'isdbgrid') {
    console.log('MongoDB transactions are available for secure identity and rental workflows.')
  } else {
    console.warn(
      'MongoDB is standalone: secure identity and rental workflows are unavailable. Keep the existing database, enable replica-set mode, and restart the API. See docs/CUSTOMER_IDENTITY.md.',
    )
  }
}
