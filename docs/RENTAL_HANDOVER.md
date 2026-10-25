# Rental pickup and return verification

Updated workflow: [Customer identity and secure addresses](CUSTOMER_IDENTITY.md). New bookings require readiness, then OTP plus separate physical handover, and return OTP plus separate receipt/inspection before completion. Legacy bookings without the new flags retain the compatibility behavior described below. The project now uses its original local database as a single-member replica set; the separate-instance instructions below are an optional development alternative, not the conversion performed on the existing service.

## Start the application

Use Node.js 24 (the version used to verify this feature). Run the API and frontend in separate terminals from the project root:

```powershell
cd server
npm ci
# On first setup only: copy .env.example to .env if .env does not already exist.
npm run start-dev
```

```powershell
cd client
npm ci
npm run dev
```

The frontend is normally at http://localhost:5173 and proxies API calls to port 5000. Sign in with an existing administrator account and open **Pickup & returns**. Existing booking approval stays under **Rental requests**. Restart the API after changing environment variables.

## Database setup and migration

The initial read-only inspection found standalone MongoDB. Follow-up local setup on 22 October 2026 converted the existing Windows MongoDB service to a single-node `rentease-rs` replica set after a verified cold backup. The original `mongodb://localhost:27017/rentease` URI, data path and application records were preserved. See [current local setup and backup notes](CUSTOMER_IDENTITY.md#configured-local-database-22-october-2026). The isolated development instructions below are alternatives, not steps to repeat on the configured service.

Pickup/return verification requires a MongoDB replica set or sharded cluster so the OTP, rental, audit record, and inventory release commit together. An Atlas cluster satisfies this requirement. Set `MONGO_URI` to its connection string. A standalone database continues to serve existing application functions; handover verification returns a clear setup error until transactions are available.

For an isolated local development replica set, create an empty directory and use an unused port. This does not migrate or overwrite the existing database:

```powershell
New-Item -ItemType Directory -Path .local-mongo -Force
& 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe' --dbpath .local-mongo --port 27018 --replSet rentease-rs --bind_ip 127.0.0.1
```

In another terminal with MongoDB Shell installed:

```powershell
mongosh --port 27018
```

In the MongoDB Shell, run:

```javascript
rs.initiate({_id:'rentease-rs',members:[{_id:0,host:'127.0.0.1:27018'}]})
```

Then use `MONGO_URI=mongodb://127.0.0.1:27018/rentease?replicaSet=rentease-rs` in `server/.env`. To preserve an existing deployment, back it up and have its operator convert that deployment or restore its backup into the replica set before changing the connection string. The new empty development instance will not contain existing accounts or products.

From `server`, inspect and preview the additive migration:

```powershell
npm run inspect-db
npm run migrate:handovers
```

After reviewing the dry-run and backing up the database, explicitly apply it:

```powershell
npm run migrate:handovers -- --apply
```

The migration only initializes missing/null rental statuses: all accepted items become `confirmed`; all rejected items become `cancelled`; other records become `pending`. It appends an explanatory history entry, increments the version, and adds indexes without dropping existing ones. It is idempotent. Existing statuses and pickup/return history are preserved. No pickup or return timestamp is fabricated. Historical active rentals without verified pickup evidence are flagged for operator review; they cannot silently bypass the OTP workflow.

The schema adds optional pickup/return timestamp and verifier fields, richer history, and two embedded challenge records under `handover`. Each challenge has a UUID, customer reference, HMAC digest, bound email digest, expiry, attempts, initiator, and verification state. Only the current challenge per action is retained; verified history permanently stores the verification reference. Hash fields are excluded from ordinary queries and removed when consumed. The new `verificationrates` collection holds shared per-administrator counters with a TTL cleanup index.

## Email and environment

Configure these **server-only** values in `server/.env`:

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | Transaction-capable MongoDB connection |
| `PORT` | API port, normally 5000 |
| `SESSION_SECRET` | Existing session signing key |
| `RENTAL_OTP_SECRET` | Recommended dedicated random HMAC key, at least 32 random bytes |
| `OTP_SECRET` | Existing OTP signing key; fallback when no dedicated key is set |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server; 465 uses implicit TLS, 587 uses STARTTLS |
| `SMTP_USER`, `SMTP_PASS` | SMTP credentials |
| `SMTP_FROM` | Authorized sender, e.g. `RentEase <rentals@example.com>` |

Use the mail provider's approved sender and app password/API SMTP credentials. Complete its sender-domain authentication before sending production mail. Codes are sent through the existing Nodemailer transport in both HTML and plain text; there is no production mock, hardcoded code, API code response, or OTP logging. A failed email invalidates the new challenge, keeps rental status unchanged, and shows a retry message. Delivery to a real mailbox must be checked using your configured SMTP account; automated tests use a captured test-only mail transport.

## Daily handover workflow

Customers may now verify their own pickup email in **My rentals**. Their booking stays Booked until an admin selects **Confirm handover** after physically providing the items. The admin-assisted flow below remains supported at handover, and return verification is unchanged. See [customer pickup and cancellation](CUSTOMER_PICKUP_CANCELLATION.md) for the new owner-only endpoints, schema fields, cancellation transactions and policy.

1. Accept all booking items through the existing approval workflow and collect the existing rental payment. The dashboard calls this **Booked** (`confirmed` in the database).
2. Open **Pickup & returns**, search by customer, item, or full rental ID, and choose **Verify pickup**.
3. The customer receives a six-digit email code. Enter or paste it into the modal. Successful backend verification records the actual pickup time and administrator and changes the rental to **On rental** (`active`).
4. On physical return, choose **Verify return**. A separate email code is required. Success records the actual return time and administrator, marks the rental `returned`, and releases only that rental's inventory slots.
5. Open **Details** to see the progress timeline, verification staff, timestamps, and history. Deposit inspection/refund remains a separate existing workflow.

Requesting/cancelling a code dialog never itself changes the rental status. Pickup and return verification screens are workflow steps, not extra business statuses. Pending, cancelled, disputed, and completed states remain supported. Pending and booked reservations block overlapping dates; an active physical rental now blocks new requests until return is confirmed, even after its scheduled end. See [catalog availability](CUSTOMER_RENTALS.md#adding-an-item-again-after-cancellation) for cancellation release and stale-slot handling.

Codes expire in 5 minutes, can be resent after 60 seconds, allow at most 5 attempts, are single-use, and are bound to rental/customer/action/challenge and the registered email. Resending replaces the previous challenge. Shared counters allow 20 sends and 100 submissions per administrator per 15-minute window, in addition to per-challenge protections. Database-backed counters apply across server processes. Failed verification consumes an attempt without changing rental state. Transaction failure rolls back successful-code consumption, status/history, inventory, and audit writes; its reserved attempt remains counted to prevent unlimited retries.

The general status API rejects direct transitions to `active` or `returned`. Completion requires a verified return; delivery staff cannot report final handover completion before its corresponding administrator verification. Optimistic concurrency rejects stale saves from legacy endpoints that race with verification.

## API

All endpoints require the existing Bearer session and administrator role. Both `/api/admin` and `/api/v1/admin` prefixes are supported. Responses containing rental data use `Cache-Control: no-store`.

| Method | Path (relative to prefix) | Use |
| --- | --- | --- |
| GET | `/rentals?q=&status=&page=1` | Paginated list, search, filters, global counts |
| GET | `/rentals/:id` | Rental details and populated verifier/history names |
| GET | `/rentals/:id/history` | Status history |
| POST | `/rentals/:id/verification/pickup/send` | Send/rotate pickup challenge |
| POST | `/rentals/:id/verification/pickup/verify` | Consume pickup OTP and activate rental |
| POST | `/rentals/:id/verification/return/send` | Send/rotate return challenge |
| POST | `/rentals/:id/verification/return/verify` | Consume return OTP and record return |

Verify bodies are `{ "challengeId": "uuid-from-send-response", "code": "six-digits-from-customer" }`. Send responses contain only a challenge reference, masked email, expiry, cooldown, and server clock. Errors include a friendly `message`, stable `code`, and, where appropriate, `retryAfter` and `Retry-After` header. There is no verification-status mutation in the browser.

## Verification and maintenance

```powershell
cd server
npm test
```

Tests use a disposable MongoDB replica set and never connect to `MONGO_URI`. The test package downloads MongoDB on first run, or uses an installed executable:

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm test
```

Frontend checks run from `client` with `npm run build`, `npm run lint`, and `npm test`. Backend integration tests cover real replica-set writes, concurrent requests, stale-save protection, failures, rollback, availability, and route authorization. Frontend DOM tests cover paste, keyboard navigation, cancel/focus restoration, errors, API submission and refresh, filtering, StrictMode, and structural accessibility. DOM testing does not verify rendered layout, color contrast, or the browser's native focus trap. Browser control was unavailable during implementation, so visual review at desktop, tablet, and phone widths remains a manual step. Native dialog provides modal focus trapping and Escape handling; motion is disabled for reduced-motion preferences.

Main implementation files: `server/src/services/rentalVerification.mjs`, `server/src/routes/rentalVerification.js`, `server/src/model/rentalRequest.mjs`, `server/src/model/verificationRate.mjs`, `server/src/config/mailer.js`, `client/src/components/admin/RentalHandover.jsx`, and its scoped stylesheet. Security timing constants are centralized in the verification service. Use this module for future handover changes; do not add alternative direct state transitions.

Transaction design follows the official [Mongoose transaction guide](https://mongoosejs.com/docs/transactions.html) and [MongoDB atomicity documentation](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).
