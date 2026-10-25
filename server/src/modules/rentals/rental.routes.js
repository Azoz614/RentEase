import { Router } from 'express'
import {
  createRental,
  listCustomerRentals,
  getCustomerRental,
  cancelCustomerRental,
  listProviderRentals,
  decideProviderItem,
  updateRentalStatus,
} from './rental.controller.js'

const router = Router()

router.post('/requests', createRental)
router.get('/requests', listCustomerRentals)
router.get('/requests/:requestId', getCustomerRental)
router.post('/requests/:requestId/cancel', cancelCustomerRental)
router.get('/provider/requests', listProviderRentals)
router.patch('/provider/requests/:requestId/items/:productId', decideProviderItem)
router.patch('/provider/requests/:requestId/status', updateRentalStatus)

export default router
