import nodemailer from 'nodemailer'

const port = Number(process.env.SMTP_PORT)

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendRegistrationOtp(email, otp) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Your RentEase verification code',
    text: `Your RentEase verification code is ${otp}. It expires in 10 minutes.`,
  })
}

export async function sendAccountOtp(email, otp, purpose) {
  const subject = purpose === 'email_change' ? 'Verify your new RentEase email' : 'Confirm your RentEase account change'
  const action = purpose === 'email_change' ? 'verify your new email address' : 'confirm this account change'
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text: `Your RentEase verification code is ${otp}. Use it to ${action}. It expires in 10 minutes.`,
  })
}

export async function sendRentalNotice(email, subject, message) {
  if (!email || !process.env.SMTP_HOST || !process.env.SMTP_FROM) return
  await transporter.sendMail({ from: process.env.SMTP_FROM, to: email, subject: `RentEase: ${subject}`, text: message })
}

export async function sendRentalSms(phone, subject, message) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from } = process.env
  if (!sid || !token || !from || !phone) return
  const body = new URLSearchParams({ To: phone, From: from, Body: `RentEase — ${subject}: ${message}` })
  const credentials = Buffer.from(`${sid}:${token}`).toString('base64')
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error(`Twilio returned HTTP ${response.status}.`)
}
