import 'dotenv/config'
import app from './app.js'
import { connectDB } from './config/db.js'
import { startDeliveryDispatch } from './modules/delivery/delivery-task.service.mjs'

await connectDB()
startDeliveryDispatch()
const PORT = process.env.PORT

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
