# Customer identity, secure addresses and rental operations

## What is implemented

Customers must submit their legal name, NIC, matching date of birth, registered email, contact phone, front/back card images, residential address and consent. The four-step form provides image previews, drag/drop or camera capture, password confirmation and real upload progress. Administrators review the actual documents under **Customer Verifications**. Uploading documents or passing format checks never grants approval.

The API reports `profile_incomplete` as a derived stage for an incomplete, unsubmitted profile. Stored review statuses are `not_submitted`, `pending`, `approved`, `rejected` and `resubmission_required`. Review status is independent of rental status. A rejected customer sees the reason and can correct and resubmit; approved/pending identity data is locked against self-editing. Address-book updates do not revoke approval.

The customer dashboard links verification, the address book, notifications and My Rentals. The administrator queue supports search, status filters, pagination, explicit sensitive details, document review, approve/reject/request-resubmission decisions and decision history. Ordinary lists show masked NICs. Administrators cannot review their own identity. Duplicate-claim support recovery requires an administrator password and investigation notes, does not reveal the other account to the claimant, blocks release while live rentals exist and never automatically approves the claimant.

## Required setup before using the live workflow

Use Node.js 24 and an **Atlas or MongoDB replica-set deployment**. This workspace now uses the existing local MongoDB database in single-node replica-set mode, as described below. Keep the intended database name in `MONGO_URI`; pointing at an empty Atlas database does not transfer your old accounts or rental history. Back up the existing database and private files before any migration. If moving to Atlas later, explicitly restore the intended backup to the selected deployment before migrating identity records.

Update `server/.env` locally; never paste credentials into chat or commit them:

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | Existing Atlas/replica-set connection with transactions and the intended database |
| `IDENTITY_ENCRYPTION_KEY` | Stable base64-encoded 32-byte AES key for NICs and private photos |
| `IDENTITY_HASH_KEY` | A separate stable base64-encoded 32-byte HMAC key for duplicate NIC claims |
| `IDENTITY_STORAGE_DIR` | Optional persistent private directory; defaults to `server/private/identity-v2` |
| `IDENTITY_RETENTION_DAYS` | Positive retention duration from review, default `365`; operational policy, not a legal-compliance claim |
| `SESSION_SECRET`, `RENTAL_OTP_SECRET` | Existing authentication and handover security settings |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Existing real email transport for notices and pickup/return codes |
| `GOOGLE_MAPS_API_KEY` | Optional existing geocoding/road-routing integration for delivery |
| `PAYMENT_PROVIDER` | Existing payment behavior; only `sandbox` is currently connected |

Generate each identity key separately in a trusted local terminal with Node's `crypto.randomBytes(32).toString('base64')`, then store it directly in your secret manager/environment. Back up keys separately from database/storage backups. Losing the encryption key makes existing documents unreadable. Changing the hash key without a controlled rehash migration breaks duplicate detection. Do not regenerate either key at startup or casually rotate it. Encryption-key rotation needs decrypt/re-encrypt tooling and a coordinated maintenance window; it is not automated here.

The private directory must never be served by Express, a reverse proxy, CDN or public bucket. The implementation rejects the application's known public upload/build directories, but deployment configuration remains the operator's responsibility. Restrict OS permissions to the API service account (configure Windows ACLs explicitly; Unix mode flags alone are insufficient on Windows). Use an encrypted disk, secured backups and a persistent volume; all API instances must share the same protected storage. `server/private/` is ignored by Git.

## Install, migrate and run

In the server directory:

```powershell
cd server
npm ci
npm run inspect-db
npm run migrate:identity
```

The last command is **preview only**. Configure both identity keys before relying on its duplicate/invalid-NIC counts: when keys are absent it reports `securityKeysConfigured: false` and cannot compute those checks. Resolve any duplicate ownership claims privately before continuing. After confirming the database, backup and preview:

```powershell
npm run migrate:identity -- --apply
npm run start-dev
```

In a second terminal from the project root:

```powershell
cd client
npm ci
npm run dev
```

Vite normally serves `http://localhost:5173` and proxies the API to port 5000. Use `npm start` in `server` for the non-watch API. Restart it after environment changes. Sharp is a new server dependency and performs real image decoding; install dependencies on the target OS rather than copying another OS's `node_modules`.

### Migration guarantees and current deployment status

`migrateCustomerIdentity.mjs` handles legacy customers, including accounts whose old documents have no role field. It reserves a canonical NIC claim where valid, encrypts the NIC, removes that migrated plaintext NIC field and marks the profile `resubmission_required`. Existing display names/contact details are reused as prefills, not certified legal identity. No birth date, structured address, document approval or new rental history is invented. Customers must supply new secure photos and an administrator must review them. Runs are idempotent; duplicate canonical claims stop the apply preflight. Each account migrates transactionally; an interruption after several accounts may leave those accounts migrated, and rerunning safely processes the remainder.

Legacy source photos are intentionally **not deleted or converted** by this migration. They must remain private. The old public/customer identity approval paths are disabled, so legacy flags cannot bypass the new approval gate. Review and separately dispose of obsolete legacy files/backups under your approved retention policy after confirming resubmission. The new retention script only manages v2 photo objects.

The initial inspection found standalone MongoDB and two legacy customer profiles needing secure resubmission. The user subsequently requested local configuration: both missing identity keys were generated privately in `server/.env`, and the existing local database was converted to single-node replica-set mode with administrator approval. No live identity migration has been applied. The earlier keyless preview's zero duplicate/invalid counts were not a completed duplicate audit; run the preview again with the configured keys before considering an apply.

### Configured local database (22 October 2026)

The existing URI is unchanged:

```dotenv
PORT=5000
MONGO_URI=mongodb://localhost:27017/rentease
```

The Windows `MongoDB` service now starts with `--replSet rentease-rs`, retaining its original configuration file, data directory, port 27017 and loopback-only binding. A single member, `localhost:27017`, was initialized and is writable primary. The driver discovers it through the existing URI; an explicit `?replicaSet=rentease-rs` may optionally be added, but is not required for this tested local connection.

Before conversion, the service was cleanly stopped and all data files were copied and SHA-256 verified. The complete backup and original service registration/configuration are in `.local-mongo/backups/before-replica-set-20261022-151137-6338280b/`. This directory is Git-ignored and restricted to the local user, Administrators and SYSTEM. An earlier `before-replica-set-20261022-150938-7e51f4ca/` attempt contains configuration/registration only, **not a complete database backup**. Neither backup was removed.

After conversion, all 14 existing application collection counts matched their pre-conversion baseline (including four accounts, one product and one rental). A real transactional write and abort succeeded without leaving a test record, and the API health check returned 200. No accounts, products, rentals or identity decisions were created or deleted for the setup check. Identity approval remains mandatory; enabling the replica set does not automatically approve any customer.

The service-start flag persists across normal service/machine restarts. If MongoDB is reinstalled or the service is recreated, retain the flag or configure `replication.replSetName: rentease-rs` in the replacement service's configuration. Do not rerun the one-time initialization against an already configured replica set, drop the `local` database or restore data files over a running service. Backup restoration/reverting topology requires an explicit maintenance procedure. The local helper and result are under `.local-mongo/`; they are intentionally not committed as portable deployment scripts.

This is a local-development single member, not a redundant production deployment. Keep it loopback-only. Production still needs authentication, protected networking and an appropriately managed replica set/Atlas deployment. The API's database startup now reports transaction availability early without logging the URI or credentials.

## End-to-end operation

1. Customer registers/signs in, opens **Identity verification**, confirms all four steps and submits with the current password. The account becomes pending and both customer/admin receive in-app notices.
2. Admin opens **Customer Verifications**, deliberately opens details, checks the original card photos and submitted information, then approves, rejects with a reason or requests correction. Review history, reviewer, timestamps, audit and notices commit together. Email failure does not undo an already committed review.
3. An approved customer selects genuinely available items/dates. Checkout displays the existing rental pricing and default address. The backend rechecks approved evidence and the actual complete default address even for direct API requests.
4. Submission atomically creates the request, immutable structured address snapshot, identity reference, item reservations, coupon redemption, audit and admin/provider/customer notices. A profile/address change during submission requires a fresh checkout. Concurrent item claims cannot both succeed. Item quantities remain one per unique physical inventory listing; this does not invent pooled stock.
5. The existing admin/owner approval screen checks identity and availability again. Rejection requires a reason and releases the rejected reservation; all rejected items use the existing cancelled request status with rejection evidence. Duplicate decisions are rejected.
6. After existing approval and payment requirements, admin chooses **Mark ready for pickup**. Customer can then request an email code from My Rentals or use the admin-assisted flow. Verifying that code records email verification only for new rentals; **Confirm handover** is a separate physical action that records the admin/time and starts the rental.
7. For return, admin sends and checks the separate return email code. The rental remains active and inventory stays blocked. **Confirm return & inspect** requires receipt and inspection notes. Only that action records actual return and releases inventory. **Complete rental** is a separate final action. Existing payment/deposit/fee records are preserved, not automatically refunded or re-priced.
8. Eligible cancellations follow the existing cutoff/refund policy, retain history and invalidate pickup/return challenges while releasing reservations transactionally. Cancelled items can be requested again if no other live reservation exists. An actively rented item remains unavailable even beyond its planned end date until physical return is recorded.

Legacy handover records keep their established administrator-assisted OTP behavior rather than fabricating readiness/inspection evidence. New requests carry `requiresPickupPreparation` and `requiresReturnConfirmation`, which enforce the separate physical confirmations above. This compatibility distinction is intentional; do not assume legacy OTP-only flows provide new inspection evidence.

Address-book create/edit/default selection always requires the current password, with database-backed attempt limits. It never rewrites an existing rental's `addressSnapshot` or restarts identity approval. Delivery requires successfully geocoded current address coordinates and configured routing; without Maps, use pickup. Ordinary display-name/contact settings cannot change the NIC or bypass the protected address endpoints.

Notifications provide read/unread filtering, mark-all-read and navigation. Booking detail timelines distinguish email checks from physical pickup/return. In-app notifications persist transactionally for the new critical actions. Emails are sent after commit; they use the real configured SMTP transport, with no invented OTP success. A durable email retry/outbox queue is not yet implemented.

## API map

All routes below also mount under `/api/v1`; all require the existing Bearer authentication unless explicitly public. Sensitive responses use private/no-store headers.

| Scope | Routes |
| --- | --- |
| Customer identity | `GET /api/identity/status`, `GET /api/identity/profile`, `POST /api/identity/check-nic`, `POST /api/identity/submit` |
| Private customer photos | `GET /api/identity/documents/:side` (only the signed-in customer's own documents) |
| Recovery | `POST /api/identity/disputes` |
| Address book | `GET /api/addresses`, `POST /api/addresses`, `PUT /api/addresses/:id`, `POST /api/addresses/:id/default` |
| Notifications | Existing list/mark-all endpoints plus `PATCH /api/notifications/:id` for owned read/unread state |
| Admin identity | `GET /api/admin/customer-verifications`, `GET /:id`, `GET /:id/documents/:side`, `POST /:id/decision` under that base |
| Admin recovery | `GET /api/admin/customer-verifications/disputes`, `POST /api/admin/customer-verifications/disputes/:id/resolve` |
| Rental creation/decision | Existing `POST /api/requests`, `PATCH /api/provider/requests/:id/items/:productId` |
| New physical stages | `POST /api/admin/rentals/:id/ready`, `/handover/confirm`, `/return/confirm`, `/complete` |
| OTP/cancellation/details | Existing customer/admin OTP, cancel and owned detail endpoints; see linked guides |

## Security and retention

NIC uniqueness uses a partial unique database index on an HMAC of the canonical identifier, including old/new equivalents. Raw NICs are AES-256-GCM encrypted and hidden by default. The duplicate API returns no other account's identity. Local format/date checks are not government verification: [DRP FAQ](https://drp.gov.lk/en/faq.php) describes the old/new NIC conversion; [DRP services](https://drp.gov.lk/en/other_service.php) describes official verification services. This application is not connected to that registry; human administrator review is mandatory and card discrepancies require support.

Only JPEG/PNG/WebP uploads passing actual Sharp decoding, size/pixel limits and dimension checks are accepted. They are rotated, re-encoded to strip metadata, encrypted with per-file nonces and stored under random private filenames. Authenticated owner/admin document fetches decrypt on demand; administrator document/full-NIC views are audited. This does not include an antivirus service or biometric verification. Both card sides are currently required for supported submissions; a reviewed one-sided-card exemption is not implemented.

The system reuses existing signed Bearer sessions and role middleware. These endpoints do not introduce cookie authentication, so ambient-cookie CSRF protection is not applicable to them; if authentication is changed to cookies, add CSRF protection and appropriate SameSite policy before deployment. Use HTTPS, a strict origin policy, a restricted service account and existing session/SMTP secrets. Do not log request bodies, card images, passwords or decrypted identity data at proxies/APM.

The default operational photo retention is 365 days after a decision. Preview expired v2 photos, then explicitly apply only after approving that policy:

```powershell
cd server
npm run identity:retention
npm run identity:retention -- --apply
```

No deletion has been run on the live database. Maintenance skips pending submissions, deletes expired private v2 photo objects, records cleanup, and preserves the minimal reviewed-document metadata, encrypted NIC claim, decision history and rental records. Approval remains valid after scheduled photo deletion. Replaced submission files are removed after the replacement transaction succeeds. Handle legacy files, orphan files after process crashes, backups, account-deletion requests and legal retention/holds through an operator-approved procedure; backup expiry is not automated. These settings are not a statement of compliance with Sri Lankan privacy law.

## Verification and limitations

Run `npm test` in each project, then `npm run build` and `npm run lint` in `client`. Backend tests use a disposable MongoDB replica set, not the configured production database. If MongoDB download is unavailable and MongoDB is installed locally, set `MONGOMS_SYSTEM_BINARY` to that machine's `mongod.exe` path and `MONGOMS_SYSTEM_BINARY_VERSION_CHECK=false` for the test process only.

Latest completed verification after the request-visibility fix: **75 backend tests passed, 63 frontend tests passed, production build passed**. Lint exits successfully with existing warnings; `git diff --check` reports no whitespace errors (Windows line-ending notices remain).

Coverage includes invalid/pending/rejected eligibility, real image decoding/encryption, duplicate NIC races, owner/admin access, required review reasons, self-review prevention, concurrent reviews, review/booking audit rollback, password limits, immutable booking addresses, full new rental lifecycle, cancellation and availability regression tests, migration/retention previews, support recovery, customer/admin forms and structural accessibility.

The implementation has been tested using isolated records and a test-only mail transport capturing real generated codes. Actual SMTP mailbox delivery, Atlas credentials, production deployment and browser/mobile visual QA still require operational validation. DOM accessibility checks do not certify color contrast or all assistive technologies. Existing client lint warnings remain in unrelated/legacy components; the production build succeeds. Payments remain the existing clearly labelled sandbox integration: Stripe/PayHere do not charge real funds here.

## Implementation file inventory

This lists identity-workflow changes and the existing handover/cancellation files it integrates with. The workspace already contained other edits; they were preserved.

- Backend schema/config: `server/src/model/{identityVerification,user,notification,rentalRequest}.mjs`, `server/src/app.js`, `server/src/config/db.js`, `server/.env.example`, `server/package.json`, `server/package-lock.json` (Sharp installation also updates local `server/node_modules/.package-lock.json`). Follow-up local setup added the two missing keys to `.env`; the user's database URI was preserved.
- New backend services: `server/src/services/{identitySecurity,identityDocuments,customerIdentity,rentalDecision}.mjs`.
- Integrated services: `server/src/services/{inventoryAvailability,rentalVerification,rentalCancellation,customerRentals}.mjs`.
- Routes: `server/src/routes/{customerIdentity,rentals,rentalVerification,admin}.js`; existing `customerPickup.js` remains the shared OTP/cancellation integration.
- New maintenance: `server/scripts/{migrateCustomerIdentity,purgeIdentityDocuments}.mjs`; existing `inspectRentalDatabase.mjs` provides the read-only topology check.
- Customer identity UI: `client/src/components/identity/{IdentityControls,CustomerVerification,AddressManager,NotificationCenter}.jsx`, `client/src/components/identity/identity.css`, `client/src/utils/{identityProfile,uploadIdentity}.js`.
- Admin/owner integration: `client/src/components/admin/{CustomerVerifications,AdminPage,RentalHandover}.jsx`, `client/src/components/admin/rental-handover.css`, `client/src/components/home/{RentalDecisionDialog,OwnerHome}.jsx`.
- Customer rental integration: `client/src/components/home/{UserHome,CustomerPickup,CustomerRentals,CustomerRentalDetails}.jsx`, `client/src/utils/customerRental.js`.
- Tests: `server/test/{databaseConfiguration,identityVerification,rentalVerification}.test.mjs`, `client/test/{customerIdentity,catalogAvailability,rentalHandover}.test.mjs`; existing customer rental tests remain in the regression suite.
- Documentation/hygiene: `.gitignore`, `docs/CUSTOMER_IDENTITY.md`, and links/compatibility notes in `docs/{CUSTOMER_RENTALS,CUSTOMER_PICKUP_CANCELLATION,RENTAL_HANDOVER}.md`.

Related guides: [Customer rentals](CUSTOMER_RENTALS.md), [Customer pickup/cancellation](CUSTOMER_PICKUP_CANCELLATION.md), [Admin handover](RENTAL_HANDOVER.md).

Follow-up: [Admin/shop request visibility](PROVIDER_REQUEST_VISIBILITY.md) documents platform-wide admin review, shop isolation and automatic request refresh.
