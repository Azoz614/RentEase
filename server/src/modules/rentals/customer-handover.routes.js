import { verificationError } from '../../middleware/workflow-error.mjs'
import { Router } from 'express'
import { requireUser } from '../../middleware/auth.mjs'
import {
  customerPickupChallenge,
  customerReturnChallenge,
  initiateVerification,
} from './handover.service.mjs'

export function createCustomerPickupRouter(dependencies = {}) {
  const router = Router()
  router.use('/requests/:id/pickup', requireUser, (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store')
    next()
  })
  router.use('/requests/:id/return', requireUser, (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store')
    next()
  })
  router.get('/requests/:id/pickup', async (req, res) =>
    res.json(await customerPickupChallenge({ rentalId: req.params.id, actor: req.user })),
  )
  router.post('/requests/:id/pickup/send', async (req, res) =>
    res.json(
      await initiateVerification({
        ...dependencies,
        rentalId: req.params.id,
        type: 'pickup',
        actor: req.user,
        customerFlow: true,
      }),
    ),
  )
  router.get('/requests/:id/return', async (req, res) =>
    res.json(await customerReturnChallenge({ rentalId: req.params.id, actor: req.user })),
  )
  router.post('/requests/:id/return/send', async (req, res) =>
    res.json(
      await initiateVerification({
        ...dependencies,
        rentalId: req.params.id,
        type: 'return',
        actor: req.user,
        customerFlow: true,
      }),
    ),
  )
  router.use(verificationError)
  return router
}
export default createCustomerPickupRouter()
