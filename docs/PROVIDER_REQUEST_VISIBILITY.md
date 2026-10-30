# Rental request visibility

## Current behavior

- A rental request goes only to whoever published each item: the owning **rental shop**, or the **administrator** for listings an administrator published with no shop assigned. Only those accounts receive the "New rental request" notification. Other administrators and shops are not notified.
- **Admin → Rental requests** and **Rental shop → Bookings** both list only bookings that contain the signed-in account's items, and only those items within mixed-provider bookings. An administrator cannot accept or decline a shop's item; the API answers `404` exactly as it does for an unrelated shop.
- **Accepting needs the account password.** The Accept button opens a dialog asking for the signed-in shop owner's or administrator's own password. A wrong password returns `403 PASSWORD_INCORRECT` with the remaining attempts. After 3 wrong entries, approvals are locked for 10 minutes (`429 APPROVAL_LOCKED` with `retryAfter`), and during the lock even the correct password is refused. A correct password clears the count. Declining needs a reason but no password. Attempts are stored on the user (`approvalPasswordFailures`, `approvalPasswordLockedUntil`) and counted with a conditional update, so parallel guesses cannot share an attempt.
- **Expiry.** The 5-minute sweep (`expireStaleBookings`) releases requests nobody answered, and approved bookings nobody paid, only once the rental period has **ended**. It used to expire them at the start time. Daily bookings start at midnight, so a request for today was cancelled within minutes as "the shop did not respond".
- Both screens refresh every 15 seconds while visible, on window focus/visibility return, when opening the request section, after decisions and through their existing Refresh buttons. Stale responses cannot overwrite newer data. A refresh error retains the last successful list and offers retry.
- Both `GET /api/provider/requests` and the older admin-only `GET /api/admin/rental-requests` use the same owner-scoped query and private/no-store response policy. Payment idempotency and transaction references are excluded from the provider list response.

## Orphaned listings

A request whose item points to a deleted shop account has no owner who can decide it, and an administrator cannot either. It expires once its rental period ends. To let someone manage such a listing, make an explicitly authorized ownership repair: assign the product to an approved shop, or to an administrator. Never expose it to every account.

## Files and checks

Backend: `server/src/modules/rentals/provider-rentals.service.mjs`, `server/src/modules/rentals/decision.service.mjs`, `server/src/modules/rentals/rental.controller.js`, `server/src/modules/rentals/cancellation.service.mjs`, `server/src/modules/users/user.model.mjs`.

Frontend: `client/src/features/rentals/components/RentalDecisionDialog.jsx`, `client/src/features/admin/components/RentalRequestsPanel.jsx`, `client/src/features/shop-owner/pages/OwnerHome.jsx`.

Regression tests: `server/test/identityVerification.test.mjs` covers owner-only delivery and notification, admin denial for shop items, the password requirement and the 3-attempt / 10-minute lock. `server/test/bookingIntegrity.test.mjs` covers expiry at the end of the period, including same-day bookings. `client/test/providerRequests.test.mjs` covers the password dialog and the locked state.
