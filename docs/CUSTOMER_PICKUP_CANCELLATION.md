# Customer pickup verification and cancellation

For identity eligibility, secure addresses and new readiness/inspection stages, start with [Customer identity setup](CUSTOMER_IDENTITY.md). New requests require admin readiness before pickup OTP, explicit physical handover after OTP, and receipt plus inspection after return OTP. The legacy OTP-only admin compatibility behavior below applies only to older records without those requirement flags.

## Use the workflow

1. As a customer, open **My rentals**. A booking must have every item accepted and payment `authorized` or `paid` before **Verify pickup** is available. The existing application has sandbox checkout; no real funds are charged.
2. Choose **Verify pickup** on the card or in **View details**. A cryptographically random six-digit code is emailed to the account's registered address through the existing SMTP transport. Enter/paste it into the six boxes. **Continue verification** resumes a live challenge without sending another email.
3. Successful customer verification records the email check, not collection. The booking remains `confirmed` (Booked) and both dashboards show **Customer email verified / awaiting handover**.
4. As an admin, open **Pickup & returns**. Select **Confirm handover**, check the customer and items, and explicitly confirm only after physically handing them over. This transactional action records the administrator, actual pickup time, history and audit, then sets `active` (On rental). A second confirmation is rejected.
5. For new requests, admin-assisted OTP also records only the email check; explicit physical handover and inspected return remain separate actions. Legacy requests without the new flags retain their established admin-assisted pickup/return behavior.

All three screens (customer cards, open customer details, admin handover list/details) refresh every 20 seconds while visible and when the window regains focus. Successful actions update their dashboard immediately. Refresh is polling, not a realtime socket guarantee.

## Cancellation policy

The existing policy is immediate cancellation, not an admin approval request. Customers may cancel `pending` bookings, or `confirmed` bookings before the platform's `cancellationWindowHours` cutoff (default 24 hours before start). The server sends eligibility/cutoff metadata; cards and details hide ineligible actions. Eligibility is checked again during the transaction.

**Cancel booking** opens a confirmation showing item names, dates, amount, consequences and an optional reason (maximum 500 characters). Confirming records `cancelledAt` and `cancellationReason`, appends history, removes outstanding handover challenges/hashes, releases inventory slots and writes an audit record atomically. Existing customer-verification history remains as evidence, but cannot authorize a cancelled handover. Cancelled bookings remain in history with no pickup, return or repeated cancellation actions; they are excluded from active/awaiting-pickup admin counts.

Only the existing sandbox authorized deposit hold is marked released locally. This feature does **not** issue a real-provider refund or introduce a rental-fee refund policy. Previously declined/cancelled bookings without timestamps keep their true historical data; no cancellation or pickup dates are invented.

## API and security

Both `/api` and `/api/v1` prefixes are supported with the existing Bearer session:

| Method | Path after prefix | Authorization / purpose |
| --- | --- | --- |
| GET | `/requests/:id/pickup` | Owner only; resume metadata, masked email and server clock |
| POST | `/requests/:id/pickup/send` | Owner only; validate eligibility and send/rotate challenge |
| POST | `/requests/:id/pickup/verify` | Owner only; `{ challengeId, code }`, email check only |
| POST | `/requests/:id/cancel` | Owner only; optional `{ reason }`, enforce cancellation cutoff |
| POST | `/admin/rentals/:id/handover/confirm` | Admin only; requires consumed customer OTP before collection |

Booking lifecycle statuses stay unchanged: verification progress is separate `pickupVerification` metadata. Codes have a five-minute expiry, five-attempt maximum, 60-second resend cooldown, shared database rate limits and single-use HMAC-hashed storage bound to rental/customer/email/action/challenge. Customer progress DTOs never expose OTPs, hashes, staff IDs or private history notes. The owner-only resume API returns a non-secret challenge reference, not the OTP. OTPs are not logged. Cancellation invalidates codes already sent, including any message already in flight; a cancelled rental cannot send a fresh code or consume a code.

Transactions and conditional/versioned writes serialize cancellation versus customer verification/admin handover. Stale saves cannot restore a cancelled status. Audit failure rolls back status, inventory and challenge changes. Direct provider transitions cannot bypass pickup or return verification.

## Database and configuration

Schema additions are optional `pickupCustomerVerifiedAt`, `cancelledAt`, `cancellationReason`, and the `customer_verified` embedded challenge status. No new collections, dependency installations, or destructive migration are needed. Restart the API to load the updated schema/routes. No deployed database records or `.env` values were changed for this implementation.

**Cancellation now also requires a transaction-capable MongoDB replica set/Atlas deployment**, as pickup/return verification already did. Standalone deployments fail closed with `TRANSACTIONS_REQUIRED`, rather than partially releasing bookings. Follow [database setup](RENTAL_HANDOVER.md#database-setup-and-migration) before using these mutations.

Existing server-only SMTP configuration is reused: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Supply a strong `RENTAL_OTP_SECRET` (or existing `OTP_SECRET`/`SESSION_SECRET` fallback) and a transaction-capable `MONGO_URI`. Restart after configuration changes. No client SMTP credentials are needed. Real mailbox delivery must be checked against the configured mail provider; tests use an injected test-only transport and real disposable replica-set writes, not production fake verification.

## Modified implementation files

- Customer UI: `CustomerPickup.jsx` and `customer-pickup.css` (new), `CustomerRentals.jsx`, `CustomerRentalDetails.jsx`, `utils/customerRental.js`, `utils/readJsonResponse.js`.
- Admin UI: `admin/RentalHandover.jsx`, `admin/rental-handover.css`.
- API: `routes/customerPickup.js` and `services/rentalCancellation.mjs` (new), `services/rentalVerification.mjs`, `services/customerRentals.mjs`, `routes/rentals.js`, `routes/rentalVerification.js`, `model/rentalRequest.mjs`, `app.js`.
- Tests: `client/test/customerRentals.test.mjs`, `client/test/rentalHandover.test.mjs`, `server/test/rentalVerification.test.mjs`.
- Guides: this file, `CUSTOMER_RENTALS.md`, `RENTAL_HANDOVER.md`.

## Verification

### Runtime troubleshooting

If the API cannot connect to local MongoDB, check `Get-Service MongoDB`. When the existing service is stopped, start it from a PowerShell terminal opened **as Administrator** with `Start-Service -Name MongoDB`, then restart the API. This does not replace the replica-set requirement for pickup/cancellation; follow the database setup guide if `TRANSACTIONS_REQUIRED` is returned. Do not replace the database connection or delete database files to resolve a stopped service.

Versioned authentication and public routes are mounted before the legacy `/api` middleware so `/api/v1/auth/login` and `/api/v1/public/products` are not incorrectly intercepted by customer authentication. A failed OTP resend now clears the replaced challenge and disables verification instead of allowing submission of the old code.

From `client`: `npm test`, `npm run build`, `npm run lint`. Existing unrelated lint warnings remain.

From `server`: `npm test`. The disposable replica-set setup and optional installed MongoDB binary are documented in `RENTAL_HANDOVER.md`. Tests never use the application's configured database. Coverage includes secure OTP generation, attempts/expiry/cooldown, customer ownership, duplicate/concurrent handover and cancellation, rollback, cancellation cutoff/reason/history, progress DTO privacy and the unchanged admin pickup/return flow. UI tests cover paste/keyboard/focus, resume/error/expiry feedback, explicit admin confirmation, open-detail cancellation refresh and structural accessibility.

DOM checks cannot verify actual mobile rendering, color contrast or native browser focus trapping. Review customer cards, nested dialogs and admin actions at phone/tablet/desktop widths before deployment; test one real SMTP delivery with your approved sender.
