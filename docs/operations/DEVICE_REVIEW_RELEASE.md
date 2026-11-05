# Device receipt review rollout

Status: implementation prepared, runtime verification and deployment pending. This document is a
release dependency and verification plan, not a production execution receipt.

A visitor who has accepted optional storage can review a finished booking created with that
browser's HttpOnly receipt without opening an email link. The server still requires a confirmed,
finished, unreviewed booking with the submitted phone. Receipt access covers exact booking IDs;
neither a submitted phone/email nor the unverified `booking_contact` form hint grants authority.
The public reviewer name is derived from that booking.

## Required order and compatibility

1. Require green CI on the integrated source, including pgTAP, real Worker/Edge/database integration,
   the customer browser suite in every configured engine, and the public review form contract.
   Local tests, builds and database execution were deliberately not run for this change.
2. Confirm the target project and its migration history with the authenticated, repository-pinned
   Supabase CLI and a read-only connection. Inspect CLI `--version` and command `--help` first.
   The repository pins CLI 2.114.0; the globally installed CLI used only to create the migration file
   was 2.108.0. Do not silently upgrade or assume CLI v3 hosted-target flags apply to v2.
3. Apply `20261105182545_device_booking_reviews.sql` before deploying the changed
   `public-booking-actions`. This additive migration creates
   `create_review_for_browser(text,text,text,integer,text)` and grants execution only to
   `service_role`. Read back the function signature and effective grants before proceeding.
4. Deploy the matching `public-booking-actions`, then the reviewed frontend that removes the
   email-verification requirement from the review form. Preserve all existing gateway, Turnstile,
   rate-limit, cookie-proof and consent configuration.
5. Record the target, exact migration version, Edge version, frontend commit and CI run in the
   actual release receipt. A new customer review or email submission in production requires the
   separate authorized release validation; the test fixtures below are for CI only.

Current deployment jobs are not ordered across database, Edge and frontend. Do not rely on an
ordinary simultaneous deployment to satisfy step 3: the new Edge RPC call fails before the migration
exists. Coordinate the additive migration as a prerequisite release before activating the new caller.
The original `create_review_with_access(text,text,integer,text)` is unchanged, so the previous Edge
version continues working against the migrated database. Older browser review payloads still work;
the request and response schemas are unchanged.

## Authority and difficult cases

- With a live receipt alone, SQL considers only IDs returned by `customer_device_booking_ids`.
  An expired, revoked, unknown or absent receipt grants nothing.
- With a verified session, verified profile emails retain their current scope. Receipt additions
  are restricted to their original `parent_email`, exactly as listing and cancellation are today.
  Anonymous receipts cannot import a different customer's bookings into that verified context.
- An expired cookie session may fall back to a live receipt, consistently with listing/cancellation.
  An explicitly supplied review `accessToken` retains the existing email-only bearer behavior and
  cannot silently fall back to another browser cookie.
- The phone cross-check, rating/text validation, confirmed status, strict completion check and
  unique `booking_id` review constraint remain authoritative. A second concurrent insertion is
  reported as `no_booking`; it cannot publish another review for the same booking.
- Receipt use does not create an email session or link profiles. Withdrawing optional storage
  still revokes receipt authority without deleting bookings or the separate verified session.

## Verification sources

| Layer       | Source and claim                                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database    | `supabase/tests/77_device_booking_reviews_test.sql`: service-only grants; receipt scope; invalid, expired and revoked credentials; phone/eligibility/validation boundaries; mixed-session precedence; original verified RPC compatibility.      |
| Edge        | `tests/unit/deviceReviewGateway.test.ts`: hashes the HttpOnly credentials, preserves explicit bearer behavior, rejects untrusted origin/signature, and retains challenge/rate-limit gates.                                                      |
| Integration | `tests/integration/deviceReviews.test.ts`: real browser adapter through Worker, Edge and Postgres; exact booking persisted without email exchange; credential denials; two database transactions contend for the same unique review.            |
| Browser     | `tools/e2e/customer.spec.mjs`: creates bookings in a fresh HTTPS browser context, receives the actual HttpOnly receipt, then reviews its completed fixture booking through the form; no email request/exchange or verified session is involved. |

The browser fixture changes only its own appointment times to make completion observable, checks the
persisted booking ID and server-derived name, and removes its own review/rate-limit rows during
cleanup. Existing verified-email integration tests remain active. Passing fixture-only UI tests is
not sufficient evidence for database authorization; all layers above must pass on the release head.

## Recovery

Roll the Edge and frontend back together to their previous compatible artifacts if necessary,
retaining the additive database function and already published reviews. Do not weaken grants,
restore anonymous review RPC execution, delete receipt/profile mappings, or disable challenge,
origin, signature, consent or rate-limit checks. Any later removal of the compatibility RPC requires
a separate release after all callers have stopped using it.

The current [Supabase function guidance](https://supabase.com/docs/guides/database/functions) describes
explicit execution grants and a constrained `search_path` for privileged functions. The
[Supabase changelog](https://supabase.com/changelog) records the CLI v3 target/confirmation changes;
these do not authorize hosted changes or alter this repository's pinned CLI version.

## Read-only production preflight, 2026-11-05

Authenticated CLI inspection confirmed the linked KNC STUDIO project is `soktgawvexeumqvtyhda`.
Comparing its remote migration history with this branch found exactly one pending migration:
`20261105182545_device_booking_reviews.sql`. The earlier contact-prefill migration
`20261105074335` is already recorded remotely. No remote migration versions are missing locally.
This was a read-only inspection; no migration or Function deployment was performed.
