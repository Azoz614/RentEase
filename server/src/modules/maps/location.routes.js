import { Router } from 'express'
import { requireUser, requireAdmin } from '../../middleware/auth.mjs'
import {
  getShopLocation,
  updateShopLocation,
  findNearbyRentals,
  listDeliveryTasks,
  getTaskRoute,
  updateTaskSharing,
  listAvailablePartners,
  assignTaskPartner,
} from './location.controller.js'

const router = Router()

router.use('/locations', requireUser, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  next()
})
router.get('/locations/shop', getShopLocation)
router.put('/locations/shop', updateShopLocation)
router.get('/locations/nearby', findNearbyRentals)
router.get('/locations/tasks', listDeliveryTasks)
router.post('/locations/tasks/:rentalId/:productId/route', getTaskRoute)
router.put('/locations/tasks/:rentalId/:productId/sharing', updateTaskSharing)
router.get('/locations/tasks/:rentalId/:productId/partners', requireAdmin, listAvailablePartners)
router.patch('/locations/tasks/:rentalId/:productId/partner', requireAdmin, assignTaskPartner)
router.use((error, _req, res, next) => {
  if (!error.status) return next(error)
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
  res.status(error.status).json({ message: error.message })
})

export default router
