import { Router } from 'express'
import { createPasswordResetHandlers } from './password-reset.controller.js'

import { createAuthHandlers, login } from './auth.controller.js'
import { createGoogleHandlers } from './google-auth.controller.mjs'

export function createAuthRouter(options) {
  const router = Router()
  const { sendRegistrationCode, verifyRegistrationCode, completeRegistration } = createAuthHandlers(options)
  const { sendPasswordResetCode, verifyPasswordResetCode, resetPassword } = createPasswordResetHandlers(options)
  const { googleConfig, googleLogin } = createGoogleHandlers(options)

  router.post('/register/send-otp', sendRegistrationCode)
  router.post('/register/verify-otp', verifyRegistrationCode)
  router.post('/register/complete', completeRegistration)
  router.post('/login', login)
  router.post('/forgot-password', sendPasswordResetCode)
  router.post('/forgot-password/verify-otp', verifyPasswordResetCode)
  router.post('/reset-password', resetPassword)
  router.get('/google/config', googleConfig)
  router.post('/google', googleLogin)
  return router
}

export default createAuthRouter()
