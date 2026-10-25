import { Router } from 'express'
import { requireUser } from '../../middleware/auth.mjs'
import { verificationError } from '../../middleware/workflow-error.mjs'
import { deliveryEvents } from './delivery-events.mjs'
import {
  listTasks,
  setPresence,
  acceptTask,
  declineTask,
  requestReturn,
  markReady,
  sendTaskOtp,
  verifyTaskOtp,
  progressTask,
  getTask,
  assignDelivery,
  quoteReturn,
  retryReturnSearch,
} from './delivery-task.service.mjs'
import { selfReturnState, sendSelfReturn, verifySelfReturn } from '../rentals/self-return.service.mjs'
import { drivingRoute } from './delivery-quote.service.mjs'
import { identityRate } from '../identity/identity-security.service.mjs'

const router = Router()
router.use('/delivery', requireUser, (req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  if (
    ['POST', 'PUT', 'PATCH'].includes(req.method) &&
    (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
  )
    return res.status(400).json({ message: 'Send a JSON object containing the requested fields.' })
  next()
})
router.get('/delivery/events', deliveryEvents)
router.get('/delivery/tasks', async (req, res) => res.json(await listTasks(req.user)))
router.put('/delivery/presence', async (req, res) =>
  res.json(await setPresence(req.user, req.body)),
)
router.post('/delivery/tasks/:id/accept', async (req, res) =>
  res.json(await acceptTask(req.params.id, req.user)),
)
router.post('/delivery/tasks/:id/decline', async (req, res) =>
  res.json(await declineTask(req.params.id, req.user)),
)
router.post('/delivery/tasks/:id/search', async (req, res) =>
  res.json(await retryReturnSearch(req.params.id, req.user)),
)
router.post('/delivery/rentals/:id/return', async (req, res) =>
  res.json(await requestReturn(req.params.id, req.user, req.body)),
)
router.post('/delivery/rentals/:id/assign', async (req, res) =>
  res.json(await assignDelivery(req.params.id, req.user)),
)
router.post('/delivery/rentals/:id/return/quote', async (req, res) =>
  res.json(await quoteReturn(req.params.id, req.user, req.body)),
)
router.get('/delivery/rentals/:id/self-return', async (req, res) =>
  res.json(await selfReturnState(req.params.id, req.user)),
)
router.post('/delivery/rentals/:id/self-return/send', async (req, res) =>
  res.json(await sendSelfReturn(req.params.id, req.user, req.body.providerId)),
)
router.post('/delivery/rentals/:id/self-return/verify', async (req, res) =>
  res.json(await verifySelfReturn(req.params.id, req.user, req.body)),
)
router.post('/delivery/tasks/:id/ready', async (req, res) =>
  res.json(await markReady(req.params.id, req.user)),
)
router.post('/delivery/tasks/:id/otp/send', async (req, res) =>
  res.json(await sendTaskOtp(req.params.id, req.body.kind, req.user)),
)
router.post('/delivery/tasks/:id/otp/verify', async (req, res) =>
  res.json(await verifyTaskOtp(req.params.id, req.body, req.user)),
)
router.patch('/delivery/tasks/:id/status', async (req, res) =>
  res.json(await progressTask(req.params.id, req.body.status, req.user)),
)
router.get('/delivery/tasks/:id/route', async (req, res) => {
  await identityRate(req.user._id, 'delivery-task-route', 30)
  const task = await getTask(req.params.id, req.user)
  res.json(await drivingRoute(task.pickup.location, task.destination.location, true))
})
router.use(verificationError)
export default router
