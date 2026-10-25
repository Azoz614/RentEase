import { Router } from 'express'

import {
  sendRegistrationCode,
  verifyRegistrationCode,
  completeRegistration,
  login,
} from './auth.controller.js'

const router = Router()

router.post('/register/send-otp', sendRegistrationCode)
router.post('/register/verify-otp', verifyRegistrationCode)
router.post('/register/complete', completeRegistration)
router.post('/login', login)

export default router
