import express from 'express'
import { requireUser } from '../middleware/auth.mjs'
import { getCurrentUser } from '../modules/users/account.controller.js'
import authRoutes from '../modules/auth/auth.routes.js'
import adminRoutes from '../modules/admin/admin.routes.js'
import rentalRoutes from './marketplace.routes.js'
import rentalVerificationRoutes from '../modules/rentals/handover.routes.js'
import customerPickupRoutes from '../modules/rentals/customer-handover.routes.js'
import customerIdentityRoutes from '../modules/identity/identity.routes.js'
import locationRoutes from '../modules/maps/location.routes.js'
import deliveryTaskRoutes from '../modules/delivery/delivery-task.routes.js'

export function createApiRouter() {
  const api = express.Router()
  api.use(customerIdentityRoutes)
  api.use(locationRoutes)
  api.use(deliveryTaskRoutes)
  api.use('/auth', authRoutes)
  api.get('/auth/me', requireUser, getCurrentUser)
  api.use('/admin', rentalVerificationRoutes)
  api.use('/admin', adminRoutes)
  api.use(customerPickupRoutes)
  api.use(rentalRoutes)
  api.use((_req, res) => res.status(404).json({ message: 'API endpoint not found.' }))
  return api
}
