# Customer-access repair — 2026-09-10

Status: prepared locally; **not deployed**. Production changes require explicit action-time approval.
Project: `soktgawvexeumqvtyhda`; Worker/site: `bladeblendstudio.se`; repository: `KNC-STUDIO`.

## Problem and preserved behavior

A raw permanent token was passed to a database function that expects its SHA-256 lookup hash.
Cross-site cookies also made customer sessions unreliable in browsers that block third-party
cookies. Concurrent session minting, rotation and ciphertext repair could preserve stale access
or replace a newer link.

Permanent random root-path email links remain. Fresh-link requests remain email-only. Price,
duration, cancellation and review eligibility remain server-authoritative. No customer data
migration, token reset, mail send or test booking is required by this release.

## Release order

1. Record current commit, deployed Worker version, both Edge function versions and applied migration
   list. Confirm backups and rollback artifacts before production schema changes. Do not replay the
   historical public-booking rollout or apply unrelated pending migrations.
2. Generate one high-entropy `CUSTOMER_GATEWAY_SECRET` (at least 32 characters) in protected local
   storage. Set identical value in Supabase Edge and Cloudflare Worker. Preserve
   `PUBLIC_ACTION_HASH_SALT`: changing it changes the permanent-token encryption key.
   Set the Worker's missing `SUPABASE_ANON_KEY` for this same project. It is public credential
   material, but must match `SUPABASE_URL`.
3. Apply exactly these reviewed migrations, in order:
   - `20260910130556_serialize_customer_access_sessions.sql`
   - `20260910133329_guard_customer_token_repair.sql`
     They replace function bodies/signature and ACLs only; existing token/session rows remain.
     The generation argument defaults to null for older callers and fails closed. During the short
     mixed-version window, an unreadable token repair can retry rather than overwrite another link.
4. Deploy `public-booking-actions`, then `send-confirmation`, from this reviewed branch. Confirm
   successful deployment and loaded function source/version. Existing direct Edge callers remain
   supported, with the new hash/session-proof behavior.
5. Build and deploy the Worker/frontend together. New browser endpoint is same-origin
   `POST /api/customer-bookings`. It forwards only the customer cookie, signs original client IP,
   timestamp, origin and body, rejects redirects and enforces body/time limits. Edge verifies HMAC
   before trusting the forwarded IP; this preserves rate-limit identity across Cloudflare zones.
6. Run the verification below. Record actual versions/results in the QA log. Local tests alone do
   not satisfy these live checks.

## Verification

- `verify:production-secrets` checks required Edge/Vault names and existing webhook digest parity.
  It now requires `CUSTOMER_GATEWAY_SECRET`; it **does not compare Worker/Edge gateway secret values**.
- Verify gateway secret parity with a signed cookie-only `list` request without credentials:
  expected semantic result is `access_denied`, not proxy-signature/config/system failure. No customer
  record, mail or booking is created.
- With approval to use an existing customer's link, verify root URL becomes clean, history shows
  correct identity/barber names, and close/reopen/reload works in Chromium, Firefox and WebKit on
  mobile and desktop. This creates an ordinary access-session row only.
- Cookie must be HttpOnly, Secure, host-only, Path=/, SameSite=Lax. JSON responses must be no-store.
  Old-cookie/new-link replacement must confirm the exact new session proof, including when the
  browser refuses a replacement cookie.
- Cross-origin POST, arbitrary upstream destinations and browser-supplied authorization must not
  reach customer data. Root token/private routes must remain noindex and uncached.
- Verify current CMS data in HTML, JSON-LD and `/llms.txt` after setting the Worker public key.
- Sending new emails, creating/cancelling a production test booking, rotating a customer's token,
  image uploads, Google Calendar connection and restore drills require separately specified
  approval and cleanup scope. Do not infer permission from this deployment approval.

## Rollback and failure handling

Keep deployed version identifiers and source artifacts. Roll back Worker/frontend as one version
if its release fails; preserve the new Edge hash fix and database race guards. Old frontend direct
Edge requests still work, though the former third-party-cookie limitation returns.

Do not rotate existing token encryption salt, restore unconditional repair, or remove session
revocation locking to recover service. A missing/mismatched gateway secret fails closed; correct
configuration and redeploy. If an Edge rollback is unavoidable, keep the database guards and
record that reverting the hash fix restores the original customer-link failure. Prefer forward
repair. Existing delivery jobs retry through their established ledger; inspect failed/permanent
jobs separately, never mass-resend blindly.

## Separate operational work

Scheduled backups currently fail because `SUPABASE_DB_URL` is missing. Configure and prove backup
plus restore under `BACKUP_RESTORE.md` before claiming launch-ready. The retired live `calendar-sync`
function needs a separate last-call/dependency check and approved removal. Neither task is silently
included in this customer-access deployment.

## Source rationale

Safari blocks third-party cookies by default: [WebKit tracking prevention](https://webkit.org/tracking-prevention/).
Cross-zone Worker requests rewrite `CF-Connecting-IP`: [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
Cookie attributes: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
