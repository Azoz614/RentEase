import { randomBytes } from 'node:crypto'

// Prints fresh secrets in .env format for one environment (local .dev.vars, or a
// GitHub Environment via `gh secret set --env <name> -f <file>`).
// Generate them once per environment and back them up: changing
// IDENTITY_ENCRYPTION_KEY makes stored identity photos unreadable, and changing
// IDENTITY_HASH_KEY breaks duplicate-NIC detection for existing customers.
const hex = () => randomBytes(32).toString('hex')
const key = () => randomBytes(32).toString('base64')

console.log(
  [
    `SESSION_SECRET=${hex()}`,
    `OTP_SECRET=${hex()}`,
    `RENTAL_OTP_SECRET=${hex()}`,
    `IDENTITY_ENCRYPTION_KEY=${key()}`,
    `IDENTITY_HASH_KEY=${key()}`,
    '# Fill these in yourself:',
    'MONGO_URI=',
    'SMTP_USER=',
    'SMTP_PASS=',
    'SMTP_FROM=',
    'ADMIN_EMAIL=',
    'GEOAPIFY_API_KEY=',
  ].join('\n'),
)
