# Rental request visibility

## Fixed behavior

- **Admin → Rental requests** shows all customer requests across platform inventory and rental shops. Admins can review any pending item, while the existing identity, availability and duplicate-decision checks still apply.
- **Rental shop → Bookings** shows only bookings containing that shop's provider ID, and only that shop's items within mixed-provider bookings. Unrelated shops and customers cannot access that queue or act on another shop's items.
- Both screens refresh every 15 seconds while visible, on window focus/visibility return, when opening the request section, after decisions and through their existing Refresh buttons. Stale responses cannot overwrite newer data. A refresh error retains the last successful list and offers retry.
- Request loading is independent of inventory, statistics, reports and other dashboard endpoints. An unrelated endpoint failure no longer hides successfully loaded requests. Pending counts exclude cancelled bookings, and cancelled bookings do not expose Accept/Decline actions.
- Both `GET /api/provider/requests` and the older admin-only `GET /api/admin/rental-requests` use the same role-scoped query and private/no-store response policy. Versioned `/api/v1` routes retain the same behavior. The old silent 100-request cutoff is removed. Payment idempotency and transaction references are excluded from the provider list response.

## Cause found in this workspace

The previous provider query required `items.providerId` to equal the signed-in account, even for administrators. The admin UI repeated that restriction for decision buttons. Both dashboards also loaded requests only at mount/manual refresh, and bundled request retrieval with unrelated endpoint calls.

A read-only check found one pending customer request whose item references a provider account no longer present in the users collection. The old exact-admin query hid it. The corrected live admin API returns both stored requests, including the pending request, without altering provider IDs, ownership, prices, identity decisions or booking history.

Legacy orphaned assignments remain available for administrator review; this fix does not guess which shop should own them or rewrite historical ownership. A shop receives requests only for items explicitly assigned to that shop. If a specific shop should manage an orphaned listing, establish and approve that shop account and perform an explicitly authorized ownership repair rather than exposing all requests to every shop.

## Files and checks

Backend: `server/src/services/providerRentals.mjs`, `server/src/services/rentalDecision.mjs`, `server/src/routes/rentals.js`, `server/src/routes/admin.js`.

Frontend: `client/src/hooks/useProviderRequests.js`, `client/src/components/admin/AdminPage.jsx`, `client/src/components/home/OwnerHome.jsx`.

Regression tests: `server/test/identityVerification.test.mjs` covers real submission to admin/owner queues, private mixed-provider scope, unrelated-shop denial, admin decisions and orphan references. `client/test/providerRequests.test.mjs` covers both dashboards, independent endpoint failure, focus/poll refresh, stale response rejection and retry behavior.

No database migration, provider reassignment or environment changes are needed for this fix. Restart the API if not using watch mode, and refresh the browser after the frontend update. Use **Admin → Rental requests** to review the existing pending request.

Verified: 75 backend tests and 63 frontend tests pass; the production build and whitespace check pass. Existing unrelated lint warnings remain. A read-only authenticated check against the running API confirmed both stored requests, including the pending one, are visible to the administrator.
