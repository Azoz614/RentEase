# Customer rental listing and details

See [Customer identity and secure addresses](CUSTOMER_IDENTITY.md) for the mandatory approval gate and updated lifecycle. New requests distinguish preparation, OTP verification, physical handover, return inspection and completion; details include relevant owned notifications and immutable address snapshots.

Sign in as a customer and choose **My rentals**. Click a rental card, press Enter/Space while it is focused, or choose **View details** to open its full booking panel. Search supports item names and short/full booking IDs. Group filters and the status selector work together; reset them with **Show all rentals**.

## Data and privacy

- `GET /api/requests` returns all bookings owned by the authenticated account, including image/category summaries from their product relationships. It is no longer silently truncated to 100 bookings.
- `GET /api/requests/:requestId` checks the rental ID and customer ownership in the database query, then returns the full customer details view. Missing and foreign rentals both return 404; malformed IDs return 400; anonymous calls return 401.
- Both routes are also available through the existing `/api/v1` rental route mount and set `Cache-Control: private, no-store` on customer data.
- The explicit customer serializer excludes OTPs, hashes, challenge IDs, administrator/staff identities, internal history notes, idempotency keys, and transaction references. Payment methods are restricted to known display-safe method names; no payment credentials are returned.
- Booked item names, rental rates/amounts, totals, discounts, deposits, and fees come from the booking snapshot. Images, descriptions, and specifications are current catalog metadata. Paused products remain available in this view. Deleted products fall back to the stored booking name/price and an image placeholder.
- Existing booking rules reserve one physical unit per unique product ID, so quantity is one for each line. This feature does not introduce quantity-based booking or change existing prices.

## Lifecycle and refresh

### Adding an item again after cancellation

The catalog starts with a valid today-to-tomorrow date range. If a date is cleared or invalid, **Choose rental dates** focuses the return-date field and explains the requirement rather than leaving an unexplained disabled add button.

Returning from **My rentals** refreshes catalog availability immediately. While browsing, availability also refreshes every 20 seconds and on window focus, without overwriting unsaved account-profile edits. Booked inventory for overlapping dates shows **Booked for these dates**; active/physically unreturned inventory shows **Currently on rental** and cannot receive a new request, even beyond its scheduled end date. Pending booking requests continue to reserve their selected dates to prevent double booking.

`inventoryAvailability.mjs` uses real booking lifecycle records as well as product slots. Cancelled/returned/completed bookings and rejected item lines do not block the product, including legacy terminal bookings with stale slots. A different live booking still blocks it. The request API applies the same check and retains an atomic, version-checked product reservation; pickup transactions touch that product version to prevent a stale availability snapshot bypassing a concurrent handover. No historic booking is deleted or silently reopened.

Regression coverage is in `client/test/catalogAvailability.test.mjs` and the backend integration suite. These changes require no new environment variables or data migration.

The detailed timeline is **Booked → Pickup verified → On rental → Return verified → Returned**. Pickup and return verification use only actual backend timestamps. Historical rentals without verification evidence show pending verification rather than an invented timestamp.

**Awaiting pickup** is a customer-facing label for a confirmed, paid booking that has not yet had pickup verified. It does not add a database state. Existing pending, disputed, completed, and cancelled states are preserved. An overdue state was not added because the current system does not define one.

The listing and an open detail panel poll every 20 seconds while visible and refresh when the tab regains focus. The panel also refreshes when payment/cancellation changes the selected rental. Older timestamped responses cannot replace newer booking state. Customers can now verify their pickup email without marking physical collection complete; an administrator must confirm the handover. See [pickup and cancellation](CUSTOMER_PICKUP_CANCELLATION.md) for the workflow, eligibility, configuration, API and modified files.

The detail panel includes item galleries, specifications, quantity, duration, booking/expected/actual dates, payment and deposit breakdowns, verification status, and the current lifecycle stage. Existing payment, invoice, cancellation, mailbox, and catalog actions remain available.

## Files and checks

- `client/src/components/home/CustomerRentals.jsx`: card grid, filters, interactions, polling, and existing payment/cancellation actions.
- `client/src/components/home/CustomerRentalDetails.jsx`: ownership-checked detail fetch, item galleries, lifecycle timeline, and detail refresh.
- `client/src/components/home/customer-rental-details.css`: responsive cards, details panel, focus styling, transitions, and reduced-motion rules.
- `client/src/utils/customerRental.js`: display-safe status labels and stale-response handling.
- `server/src/services/customerRentals.mjs`: customer-only response serialization and related product metadata.
- `server/src/routes/rentals.js`: protected listing and details endpoints.
- `client/test/customerRentals.test.mjs` and `server/test/rentalVerification.test.mjs`: UI and real MongoDB integration tests.

Run `npm test`, `npm run build`, and `npm run lint` from `client`. Run `npm test` from `server` using the test MongoDB setup described in `RENTAL_HANDOVER.md`. No schema migration, new environment variables, or runtime dependencies are required for this feature.

DOM tests cover card clicks/keyboard entry, focus restoration, gallery selection, multi-item details, status refresh, filtering, empty/error/loading states, and structural accessibility. Backend tests cover ownership, anonymous and foreign access, privacy exclusions, inactive/deleted products, preserved snapshot prices, and status/timestamp changes through the real OTP transaction service. Automated DOM checks do not establish visual rendering or color contrast; browser review at phone, tablet, and desktop sizes remains necessary when browser access is available.
