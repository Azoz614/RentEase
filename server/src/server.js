import 'dotenv/config'
import app from './app.js'
import { connectDB } from './config/db.js'
import { startDeliveryDispatch } from './modules/delivery/delivery-task.service.mjs'
import { expireStaleBookings } from './modules/rentals/cancellation.service.mjs'

await connectDB()
startDeliveryDispatch()
// Matches the Worker's 5-minute cron: release bookings nobody acted on by their start time.
const sweepBookings = () =>
  expireStaleBookings().catch((error) => console.error('Booking expiry sweep failed:', error.name))
setInterval(sweepBookings, 5 * 60_000).unref()
sweepBookings()
const PORT = process.env.PORT

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
