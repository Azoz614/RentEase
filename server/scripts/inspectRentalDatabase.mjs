import 'dotenv/config'
import mongoose from 'mongoose'

// Read-only: reports topology and aggregate counts without printing connection secrets or PII.
try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  const db = mongoose.connection.db
  const hello = await db.admin().command({ hello: 1 })
  const statuses = await db
    .collection('rentalrequests')
    .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    .toArray()
  console.log(
    JSON.stringify(
      {
        transactionsSupported: Boolean(hello.setName || hello.msg === 'isdbgrid'),
        rentalStatuses: statuses,
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(
    `Database inspection unavailable (${error.name}). Check MongoDB connectivity and MONGO_URI.`,
  )
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
