import nodemailer from 'nodemailer'

const port = Number(process.env.SMTP_PORT)

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 30_000,
  dnsTimeout: 30_000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const retryableTransportErrors = new Set([
  'EDNS',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ESOCKET',
  'EHOSTUNREACH',
  'ENETUNREACH',
])
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

// Registration, account, and handover codes all use this same transport. Retry
// only temporary network failures; invalid recipients and SMTP auth failures are
// returned immediately and are never reported as delivered.
async function sendMail(message) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await transporter.sendMail(message)
    } catch (error) {
      if (attempt || !retryableTransportErrors.has(error?.code)) throw error
      await pause(1_000)
    }
  }
}

export async function sendRegistrationOtp(email, otp, message = {}) {
  await sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: message.subject || 'Your RentEase verification code',
    text: message.text || `Your RentEase verification code is ${otp}. It expires in 10 minutes.`,
  })
}

export async function sendAccountOtp(email, otp, purpose) {
  const subject =
    purpose === 'email_change'
      ? 'Verify your new RentEase email'
      : 'Confirm your RentEase account change'
  const action =
    purpose === 'email_change' ? 'verify your new email address' : 'confirm this account change'
  await sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text: `Your RentEase verification code is ${otp}. Use it to ${action}. It expires in 10 minutes.`,
  })
}

export async function sendHandoverOtp(email, otp, type, rentalId) {
  const action = type === 'pickup' ? 'Pickup' : 'Return'
  await sendRegistrationOtp(email, otp, {
    subject: `Your RentEase ${action.toLowerCase()} verification code`,
    text: `Your RentEase ${action.toLowerCase()} verification code is ${otp}. It expires in 5 minutes. Give this code to an authorized shop owner or administrator to complete rental #${rentalId}.`,
  })
}

export async function sendRentalNotice(email, subject, message) {
  if (!email || !process.env.SMTP_HOST || !process.env.SMTP_FROM) return
  await sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `RentEase: ${subject}`,
    text: message,
  })
}

export async function sendRentalSms(phone, subject, message) {
  const {
    TWILIO_ACCOUNT_SID: sid,
    TWILIO_AUTH_TOKEN: token,
    TWILIO_FROM_NUMBER: from,
  } = process.env
  if (!sid || !token || !from || !phone) return
  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: `RentEase — ${subject}: ${message}`,
  })
  const credentials = Buffer.from(`${sid}:${token}`).toString('base64')
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!response.ok) throw new Error(`Twilio returned HTTP ${response.status}.`)
}
