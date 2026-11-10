# Production backend — Blade & Blend Studio

Production uses Supabase for PostgreSQL, Auth, Storage, and Edge Functions; Resend for booking and
Auth email; Cloudflare Turnstile for booking abuse protection. Frontend runs on Cloudflare.

## Runtime flow

1. Browser posts name, phone, email, barber, service ID, start time, language, and Turnstile token to
   same-origin `/api/bookings`; the Worker relays only to `submit-booking`.
2. Gateway fails closed unless Turnstile and IP-salt secrets are configured, applies coarse IP/phone
   limits, then calls `create_booking` with the service-role key.
3. Database derives service name, price, and duration from active `services`; browser values cannot
   change commercial fields.
4. Insert trigger queues a `booking_email_delivery_jobs` row; the one-minute `pg_cron` dispatcher
   invokes `send-confirmation` through a Vault-held URL and shared secret.
5. Resend emails customer and linked barber. Confirmation/reminder contains the current permanent
   email-scoped **Mina bokningar** token. The root-path link enters through the Worker, which redirects
   into the app; browser actions then use same-origin `/api/customer-bookings`. The Worker signs the
   origin, timestamp, client IP, and body with `CUSTOMER_GATEWAY_SECRET` before calling the Edge gateway.
   Valid access receives a first-party HttpOnly `SameSite=Lax` session cookie. Requesting a new link by
   email rotates the token and invalidates the previous token. Phone remains booking contact data and
   review cross-check, not a lookup field.

After an accepted functional-storage choice, a successful first-party booking also receives an
independent HttpOnly device-receipt cookie. It grants only the exact new booking IDs; submitted email
or phone never grants earlier history. Browser Web Locks serialize initial receipt creation across
tabs. The browser verifies receipt proof and the new booking ID before showing immediate access.
Cookie/probe failure keeps booking success and offers the email link. Withdrawing consent deletes
receipt authority and device contact prefill; the essential email-verified session and booking rows
remain separate. The list response may include `booking_contact` from the latest exact-ID receipt-owned
booking for device authority. This unverified form hint never becomes `profile` or grants authority.
Email linking and earlier history still require verified access. Verified profile contact takes
precedence. Form hints live only in component memory; consent withdrawal, receipt expiry/revocation, and focus revalidation clear them
without replacing fields the customer has edited. The frontend tolerates older gateways without
this additive response field.

After the device-review rollout, the same receipt also
allows a review for an exact owned booking without an email click. The service-only
`create_review_for_browser` RPC uses the list/cancel predicate: verified profile emails, or exact
receipt IDs restricted to that verified session's original parent email when a session exists.
A receipt alone never expands through a shared phone or email. SQL also requires a matching phone,
`confirmed` status, an end time strictly before database time, and no prior review; the unique
booking constraint handles concurrent submissions. The public name comes from the booking.
Turnstile, origin/gateway checks and per-IP/per-phone review limits remain in the Edge path.
Explicit review bearer requests retain their original email-only scope without cookie fallback.

Verified customers may link their email identities through `request_link` and `confirm_link` on
the same signed gateway. `customer_profiles` and `customer_profile_emails` group addresses only
after fresh proofs sent to both mailboxes, confirmed from the exact initiating email session.
The request binds the displayed source email too, so a cookie changed in another tab fails closed.
`customer_email_links` retains hashed/encrypted 30-minute proofs, credential generations and profile
versions. Ordered profile locks make a whole-group merge atomic; rotation and competing merges
invalidate stale requests. `/#email_link=...` is removed from the URL into component memory and
requires an explicit button press; opening the URL never exchanges an access credential.
Verified list/cancel/review share the group scope. Phone collisions never join profiles, and
device receipts keep their original exact-booking/exact-parent-email boundary.

The `external_action_jobs` outbox covers Calendar actions, Storage cleanup, customer-access email, and
Auth user lifecycle actions. Booking email delivery has its separate
`booking_email_delivery_jobs` ledger; Auth email sends directly through Resend; and `upload-image`
is synchronous while its managed Storage cleanup is durable. Cron retries failed outbox actions,
preserves Calendar event identifiers until Google deletion succeeds, and reconciles managed Storage
bytes left unreferenced for 30 minutes after a failed upload compensation path. `upload-image`
registers CMS library media and barber photos; Studio publication assigns gallery images and the
homepage logo. Raw image bytes and service credentials never enter browser config.

The durable dispatchers use a 30-second pg_net request budget. Edge handlers retain their promise
through the native `EdgeRuntime.waitUntil` hook when available; the database ledgers still own
retry and completion. Resend HTTP success requires a valid message UUID before delivery is marked.
Function logs record only that provider ID, never message bodies or customer-access links. The
owner-only email send log stores a copy of each app email (recipient, subject, HTML and text) with
sign-in and access links replaced by `[dold länk]`; a daily purge deletes it once 30 days have
passed since the first send attempt.

Two more nightly `pg_cron` jobs bound how long customer data stays.
`booking-retention-purge` (03:11 UTC) deletes up to 500 bookings a run whose appointment ended
more than 12 months ago. It first dismisses their failed booking emails, as the owner's dismissal
does; a booking whose email is still pending or dispatching waits for a later run.
`customer-booking-access-cleanup` (03:23 UTC) also removes the contact data of an email address
nothing uses any more: its access token, its profile membership and then the empty profile. An
address is in use while it has a booking, an unexpired session or device receipt, a stored email
link, or an unused, unexpired access challenge; addresses linked to one profile count together.
Before those steps the job deletes each unused access challenge that has no pending or dispatching
access email job, for at most 200 addresses a run.

The owner moderates reviews through `admin_list_reviews`, `admin_set_review_published` and
`admin_delete_review`. Hiding keeps the row, so the booking cannot be reviewed a second time;
deleting removes only the review, and the booking becomes reviewable again. `admin_audit_log`
records staff changes: who, the action, the table, the row's primary key and, for an update, the
names of the changed columns, never values. Triggers on the staff-managed tables, `reviews` and
`bookings` write an entry only when the request carries the JWT of a staff profile, and a trigger
on `cms_revisions` writes one entry per Studio publish. Four Edge Functions that change rows with
the service role name the acting staff account through `internal_record_admin_action`, called from
`supabase/functions/_shared/adminAudit.ts`: `admin-create-barber` (profile and invitation),
`upload-image` (barber photo), `calendar-oauth-callback` (stored calendar link) and
`calendar-disconnect` (disconnect request). Each gives up the log write, and any read it makes only
for the log, after 3 seconds (`ADMIN_LOG_BOUND_MS`) and answers as it would have; a failed write
logs the function name and an error code only. Only the owner reads the log, through
`admin_list_audit_log`, and `admin-audit-log-purge` (03:41 UTC) deletes entries older than 12
months.

The `gallery_public_read` and `barber_photos_public_read` Storage policies are dropped, so `anon`
and `authenticated` can no longer list the `gallery` and `barber-photos` buckets. Their objects are
still served by public URL.

## Public frontend configuration

Only public values use the `VITE_` prefix:

```dotenv
VITE_SITE_URL=https://bladeblendstudio.se
VITE_CLOCK=real
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
VITE_TURNSTILE_SITE_KEY=<public-site-key>
```

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, `CUSTOMER_GATEWAY_SECRET`,
or webhook secrets in frontend variables.

Production builds require both public Supabase values and fail if either is missing. Local
development may use the existing mock adapters; it must not silently become a production build.

## Apply backend changes

A merge to `main` applies migrations, deploys Edge Functions and builds the Worker within about
90 seconds, in no enforced order, so every change must work with the previous and the next
version on the other side. A change that needs a strict order ships as two releases: the first
stops using the old interface, and the second removes it once the first is verified live. The
legacy gallery/logo writer RPCs follow this pattern: they stay in this release, and the
`supabase/functions/upload-image/README.md` describes their later removal. One order is checked,
not waited for: `npm run deploy:frontend` (`package.json`) runs `verifyBackend` in
`tools/release/cms-release.mjs` before `wrangler deploy`. It sends one request to the deployed
`cms-studio` and stops the deploy unless that function reports the CMS release digest of this
checkout.
Use the current migration tree and `supabase/config.toml` as the deployment inventory; completed
September rollout checklists are retired. The public gateway contract is already authoritative:
never restore anonymous execution of booking/customer RPCs during recovery. After an irreversible
schema retirement, use a reviewed forward migration and compatible application artifacts.

The durable `booking_calendar_sync_on_change` trigger queues Calendar work through
`calendar_event_sync`; `external-cleanup` dispatches it. The legacy Calendar webhook/function
is retired. Verify the current schema, function inventory and Edge/Vault secret parity before
release; repository source alone does not prove a hosted environment matches it.

### Migration baseline

`supabase/migrations/20261105182545_baseline.sql` replaces the 106 migrations that built the schema
up to 2026-11-05. A database built from it has the same schema dump (every schema, owners and
privileges included) and the same seeded rows, scheduled jobs and buckets as one built from the
original chain. It keeps the version of the last original migration, so a database that ran the
chain treats it as applied. Add new migrations after it and do not edit it.

Production ran the original chain, so its history lists 106 versions and the repository now has
one. The Supabase CLI refuses to push migrations while the remote history names versions the
repository lacks. Remove the 105 older rows once, when this change is released:

```sql
delete from supabase_migrations.schema_migrations where version <> '20261105182545';
```

The statement changes no schema or data. A backup taken before it holds the 106-row history in its
`history_schema.sql` and `history_data.sql`. Restoring that history into a new restore target runs
`tools/backup/prepare-migration-history.sql`, then `history_schema.sql`, then `history_data.sql`,
in one transaction; it brings the 106 rows back, so run the same statement after it. Migration
file names from before the baseline in older release records refer to the original chain;
`git log -- supabase/migrations` has them.

### Recovery compatibility

- Preserve the existing `PUBLIC_ACTION_HASH_SALT` when updating an environment. It also derives
  the encryption key for permanent customer tokens; rotation requires a deliberate token
  repair/migration plan. The secret-setting example below is not a rotation instruction.
- Check compatibility at each rollout step. Stricter request validation may require compatible
  callers to be released first. Roll back only to compatible Worker/frontend and Edge artifacts,
  retaining gateway signatures, session proofs, token-generation checks and separate allowlisted
  `Set-Cookie` headers. Correct configuration without bypassing those checks.
- Keep additive device-receipt tables and grants until their credentials expire. Do not drop or
  split verified customer profile mappings to repair a deployment; use a reviewed, data-preserving
  forward migration that retains the identity rules above.
- Inspect delivery and provider evidence before retrying work. Do not force jobs to completed or
  resend them in bulk. The [booking-email recovery contract](supabase/functions/send-confirmation/README.md)
  owns generation-safe token repair and retries that preserve acknowledged recipients.

### Runtime configuration

Required Edge Function secrets:

```bash
npx supabase secrets set \
  RESEND_API_KEY=<active-resend-api-key> \
  TURNSTILE_SECRET=<turnstile-secret> \
  IP_SALT=<random-long-value> \
  PUBLIC_ACTION_HASH_SALT=<different-random-long-value> \
  PUBLIC_SITE_ORIGINS=https://bladeblendstudio.se,https://www.bladeblendstudio.se \
  PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
  GOOGLE_OAUTH_CLIENT_ID=<google-client-id> \
  GOOGLE_OAUTH_CLIENT_SECRET=<google-client-secret> \
  CALENDAR_STATE_SECRET=<different-random-long-value> \
  CUSTOMER_GATEWAY_SECRET=<same-random-long-value-as-Worker> \
  WEBHOOK_SECRET=<random-long-value>
```

Database Vault must contain:

- `booking_confirmation_url` = `https://<project-ref>.functions.supabase.co/send-confirmation`
- `external_cleanup_url` = `https://<project-ref>.functions.supabase.co/external-cleanup`
- `booking_webhook_secret` = same value as `WEBHOOK_SECRET`

Create or rotate these through Supabase SQL Editor with `vault.create_secret` / `vault.update_secret`.
Do not commit their values.

The eight functions the admin panel calls from the browser (`admin-create-barber`,
`admin-manage-barber`, `calendar-disconnect`, `calendar-oauth-start`, `redeem-staff-invite`,
`send-email-change`, `send-recovery-email`, `upload-image`) send `Access-Control-Allow-Origin` only
to these origins: `https://bladeblendstudio.se`, `https://www.bladeblendstudio.se`,
`http://localhost:<port>`, `http://127.0.0.1:<port>` and each origin in the comma-separated
`CMS_ALLOWED_ORIGINS`, the list `cms-studio` also reads. A browser on any other origin gets no such
header and refuses the answer. `calendar-oauth-start` also answers 403 `origin_not_allowed` to an
`https` Origin outside `PUBLIC_SITE_ORIGINS` (unset: the two production origins). It signs only
an origin from that list into the OAuth state, and `calendar-oauth-callback` returns the browser to
that origin's `/admin`; without one, the callback shows its own page.
`send-email-change` requires the caller's current password as `current_password` and checks it
with a sign-in that uses `SUPABASE_ANON_KEY` from the function environment, then revokes that
sign-in's session. One attempt per account a minute is counted before the check (429
`rate_limited`); a wrong password answers 200 `wrong_password`, and any other refused sign-in 503
`reauth_unavailable`. `admin-manage-barber` and `upload-image` also read `SUPABASE_ANON_KEY`;
without it `send-email-change` answers 503 `not_configured` and the other two 500
`not_configured`.

Cloudflare Worker also needs `SUPABASE_ANON_KEY` as a secret so initial HTML, JSON-LD,
`/llms.txt`, `/sitemap.xml` and `/.well-known/security.txt` use current public CMS data; its
same-origin gateways answer 503 `not_configured` without it:

```bash
printf '%s' '<public-anon-key>' | npx wrangler secret put SUPABASE_ANON_KEY
```

The Worker also generates two discovery files. `/sitemap.xml` lists the five core pages and every
created page of the current publication except one whose Swedish body still holds the paragraph a
new page is created with; when the publication cannot be read, the static `public/sitemap.xml`
answers with the core pages only. `/.well-known/security.txt` names the business email from
Företag & SEO as contact when it is a plain address, otherwise the default address in
`modules/public-web/src/site/business.ts`, and expires 180 days after 00:00 UTC of the day it is
served. `/my-bookings` is an
account page: its HTML says `noindex, follow` and has no canonical link, and the response carries
`X-Robots-Tag: noindex`.

The Worker customer proxy also needs the same high-entropy `CUSTOMER_GATEWAY_SECRET` value that the
`public-booking-actions` Edge Function uses. Missing or mismatched values fail closed; deploy both
values with the Worker/Edge change. A secret-name inventory alone does not prove these values match:
verify that a signed same-origin gateway request reaches the expected application response while
customer responses remain `no-store`.

Besides the `ASSETS` binding of the built `dist/`, `wrangler.jsonc` gives the Worker two plain
variables, `SUPABASE_URL` and `MAINTENANCE`, and the `GATEWAY_RATE_LIMIT` binding, which counts
requests to `/api/customer-bookings` per client and action, an IPv6 client being its /64 (its
`ratelimits` entry holds the limit and period). The limit is approximate: Cloudflare keeps the
counts per location and they are eventually consistent, so a burst can pass more than the 60
requests in 60 seconds before the first 429. Without the binding, or when it fails, the gateway
lets the request through.
`MAINTENANCE` is `off`. Set it to `on` and deploy the Worker to close the
site: every page request the Worker receives answers 503 with `public/maintenance.html`, and its
JSON endpoints answer 503 in JSON. Set it back to `off` and deploy to open the site again. A
request whose handling throws in the Worker answers 500 with `public/500.html` in the same way,
and the Worker logs the caught error, without the request, to Workers Logs.

## Resend

Verify `bladeblendstudio.se` in Resend and add every DNS record Resend provides through Cloudflare DNS.
Production senders are:

- booking and Auth email: `Blade & Blend Studio <booking@mail.bladeblendstudio.se>`

Validate an API key before installing it:

```bash
curl -fsS -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains
```

Push Supabase Auth URL, redirect, MFA, OTP, and SMTP settings with the key available only in the shell:

```bash
export RESEND_API_KEY=<active-resend-api-key>
npx supabase config push --yes
```

The same push installs the Auth email templates in `supabase/templates/`; a merge does not.
`supabase/templates/email-change.html`, the message Auth sends when a session changes its email
directly, carries no confirmation link, token or code: staff change their login email through
`send-email-change`.

Public signup remains disabled. Owner creates barber accounts from admin. Each barber receives a
single-use invitation and sets a personal password before first login. Password reset email uses
Supabase Auth through Resend. Nothing sets `profiles.must_change_password` any more and no screen
clears it. The admin refuses a profile that has it set, as it refuses a disabled account; clear it
in the database (`update public.profiles set must_change_password = false where id = …`).

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run deploy:dry-run
npx supabase migration list --linked
npx supabase functions list
npx supabase config push --yes
```

For database integration tests, start Docker then run:

```bash
npx supabase start
npx supabase test db
npm run test:integration
```

`.github/workflows/live-smoke.yml` runs `tools/smoke-live.mjs` against production every day at
04:43 UTC and on manual dispatch, with the public values of the tracked `.env` and no secret. The
script's header lists its checks. Its booking and gateway requests are built to be refused, so the
manual test below still covers delivery, customer links and cancellation.

Production smoke test:

1. Book a test slot with a real test email and phone.
2. Confirm customer and linked barber each receive one email.
3. Follow the random root-path customer link; confirm it opens **Mina bokningar** through the Worker
   redirect and establishes a first-party HttpOnly session.
4. Request a fresh link using email only; confirm the previous link reports replacement/expiry.
5. Cancel the booking and confirm it disappears from upcoming bookings.
6. After appointment time, confirm review eligibility uses the same phone.

## Local customer verification

See [README local setup](README.md#local-customer-links-and-cookies). Vite dev/preview proxy the
customer route to the real local Worker; a Vite server alone cannot implement customer sessions.
`npm run test:e2e:customer` runs the actual HTTPS Worker → Edge → PostgreSQL path in Chromium,
Firefox and WebKit. It verifies host-only HttpOnly cookies, successful profile hydration, shared-cookie
customer switching, cookie rejection, invalid-link denial, rotation, concurrent booking receipts,
consent withdrawal and device cancellation. Only cookie rejection is
intercepted; those responses still come from the real backend.

Existing `reviews.test.ts` integration cases force overlapping transactions and observe
`pg_blocking_pids`: permanent/legacy session mint against rotation in both lock orders, plus stale
ciphertext repair against a newer rotation. Sequential pgTAP checks remain complementary. These
local/CI gates do not prove inbox delivery, live secrets or deployment state.

## Free-tier operations

Supabase Free has no production backup guarantee. GitHub workflow `database-backup.yml` creates an
encrypted daily database-and-Storage artifact with migration lineage and byte verification only after
all repository secrets/variables are configured. On 2026-09-13 the owner authorized a database-password
rotation, `SUPABASE_DB_URL` was configured, and production backup run `34764434644` succeeded.
Its encrypted artifact passed checksum, decryption and inventory checks. The daily schedule remains
02:17 UTC; that verified run was manually dispatched. Keep migrations in source control and never
upload plaintext dumps.

## Mock fallback

If both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are blank at build time, frontend uses local
mock adapters and persists nothing. Production must always build with both values present.
