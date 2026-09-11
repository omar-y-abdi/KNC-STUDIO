# Customer cookie and device-access release

PR58 is already on main (`6da1b7723f2eb8611789110b4c9ebfc8b46986a6`). This release follows it;
do not replay the earlier customer-token repair or rotate its encryption salt.

## Problem and contract

Production Supabase returns separate application and provider `Set-Cookie` headers. Joining them
attached `Domain=supabase.co` to the site's `__Host-` cookie. Browsers correctly rejected the session,
even with cookies enabled. The Worker now forwards only the two application cookies, separately.

- Email links retain their permanent-until-rotated lifecycle and mint a 30-day essential session.
- Functional consent permits a separate, HttpOnly, host-only receipt for exact newly created booking
  IDs. A receipt never authenticates entered email/phone, exposes a verified profile, or permits reviews.
- Receipt collections expire 30 days after creation. Append preserves the server expiry and sets only
  its remaining cookie lifetime. Existing verified identity limits which attached grants it can see.
- Web Locks serialize booking/probe/withdrawal across tabs. Without locks, consent, cookie acceptance,
  or successful receipt verification, booking still succeeds and the email link remains the fallback.
- Rejecting optional storage revokes the receipt; it preserves bookings and essential verified sessions.
- Customer email-alias linking is not introduced by this migration.

## Deployment order

1. Verify encrypted backup and reviewed PR/CI. Keep `PUBLIC_ACTION_HASH_SALT` unchanged.
2. Apply only `20260910214200_customer_device_booking_receipts.sql`. Existing functions remain
   compatible; this is an additive migration. No seed/reset/role import in production.
3. Publish Worker/frontend with unchanged matching `CUSTOMER_GATEWAY_SECRET` and `SUPABASE_ANON_KEY`.
   The old Edge accepts the new booking body and Turnstile action; optional device access temporarily
   falls back to email until step4. The P0 cookie forwarding fix works immediately.
4. Deploy `submit-booking`, `public-booking-actions`, and `send-recovery-email` from this release.
   Verify `TURNSTILE_SECRET`, `IP_SALT`, `PUBLIC_ACTION_HASH_SALT`, and `PUBLIC_SITE_ORIGINS` remain
   configured. The shared verifier checks exact hostname/action and fails closed after8s. Old forms
   already open before the release may need reloading. Test secrets are rejected on production hosts.
5. Verify production versions/health, then one explicitly authorized test booking: functional consent,
   immediate device history, actual inbox link, fresh browser email history, cancellation, admin and
   Google Calendar propagation. Remove only that test's data through normal supported controls.
6. Remove the deployed legacy `calendar-sync` only after the separate Calendar live retirement gate
   passes. Receipt deployment does not require its deletion.

If automatic deployments cannot preserve steps3–4, stage the frontend/Worker first and deploy Edge
manually after its version is confirmed. Do not promote strict action checking before its callers.

## Verification and rollback

- `npx supabase test db --local` includes67 permanent-link/receipt boundary assertions.
- `npm run test:e2e -- --customer`: actual local HTTPS Worker → Edge → DB, real browser cookie jar,
  extra provider cookie, Chromium/Firefox/WebKit, accepted/rejected cookies, customer switch, rotation,
  concurrent first bookings, exact-ID scope, consent withdrawal and cancellation.
- Unit tests exercise receipt proof, fallback success, expiry, cookie allowlist and Turnstile policy.
- Backup restore evidence: all53 source table counts,80 migration rows,2 Storage buckets/2 objects
  matched a separate local target; encrypted archive preserved outside Git.

For application rollback, redeploy the prior Edge and frontend together, retaining the corrected
Worker Set-Cookie forwarding. Keep additive receipt tables until their credentials expire; old code
ignores them. Do not roll back to the broken header merge or drop receipt grants during an incident.
Daily GitHub backup still requires the owner's permanent `SUPABASE_DB_URL` secret.

References: [Cloudflare header handling](https://developers.cloudflare.com/workers/runtime-apis/headers/),
[Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[official test credentials](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
