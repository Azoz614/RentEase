import { Router } from 'express'
import { quoteDelivery, listAssignments, updateAssignmentStatus } from './delivery.controller.js'

const router = Router()

router.post('/delivery/quote', quoteDelivery)
router.get('/delivery/assignments', listAssignments)
router.patch('/delivery/assignments/:requestId/items/:productId/status', updateAssignmentStatus)

export default router
