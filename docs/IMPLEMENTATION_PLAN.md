# RentEase implementation plan

RentEase is being delivered as a modular monolith. Each module owns its models, route handlers, policies, and future services; modules may later be extracted only when operational load requires it.

## Current foundation

- Product catalog, image uploads, specifications, deposits, hourly/day/week pricing, long-rental discounts, and date-range availability.
- Atomic product-slot reservation checks to prevent overlapping rentals.
- Customer, rental-shop, delivery-partner, and administrator roles; registration verification; identity-review workflow; audit log; in-app, email, and optional SMS notices.
- Pickup/delivery quotations, delivery status tracking, coupons, loyalty, wishlist, ratings, owner listings, and admin package APIs.

## V1 — business inventory rental

1. Complete the rental state machine: `pending`, `confirmed`, `active`, `returned`, `completed`, `cancelled`, and `disputed`.
2. Add provider-neutral payment intents, idempotency keys, deposits, refunds, late/damage adjustments, and invoices. A live Stripe/PayHere integration is enabled only after gateway credentials and merchant approval are configured.
3. Add booking calendar and availability APIs, booking revenue reporting, and invoice download.
4. Strengthen operational protections: request limits, security headers, input schemas, health/readiness checks, tests, and API documentation.

## V2 — marketplace

1. Keep the existing rental-shop workflow and add peer-owner permissions where policy permits.
2. Add authenticated conversation threads, return confirmation, claims/disputes with evidence, two-way reviews, commissions, and payout ledger records.
3. Escrow is a payment-provider feature, not a database-only flag. Funds will not be represented as held or released until a connected, compliant payment provider confirms those operations.

## V3 — packages

1. Expose the existing package builder in the admin workspace.
2. Provide public package discovery, item/add-on selection, date-aware availability checking, and recalculated prices.
3. Include seasonal availability windows and promotional pricing.

## Delivery sequence

The application will remain deployable after each slice: V1 state and payments domain first, V2 collaboration/claims second, and V3 customer package checkout third. Third-party services remain disabled by default and are activated via environment variables in staging and production.
