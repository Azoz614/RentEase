import { createHmac } from 'node:crypto'

export function hashOtp(email, otp) {
  return createHmac('sha256', process.env.OTP_SECRET).update(`${email}:${otp}`).digest('hex')
}
