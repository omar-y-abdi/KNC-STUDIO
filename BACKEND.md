# Production backend — Blade & Blend Studio

Production uses Supabase for PostgreSQL, Auth, Storage, and Edge Functions; Resend for booking and
Auth email; Cloudflare Turnstile for booking abuse protection. Frontend runs on Cloudflare.

## Runtime flow

1. Browser posts name, phone, email, barber, service ID, start time, language, and Turnstile token to
   `submit-booking`.
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
   review scope, not a lookup field.

The `external_action_jobs` outbox covers Calendar actions, Storage cleanup, customer-access email, and
Auth user lifecycle actions. Booking email delivery has its separate
`booking_email_delivery_jobs` ledger; Auth email sends directly through Resend; and `upload-image`
is synchronous while its managed Storage cleanup is durable. Cron retries failed outbox actions,
preserves Calendar event identifiers until Google deletion succeeds, and reconciles managed Storage
bytes left unreferenced for 30 minutes after a failed upload compensation path. Homepage-logo
replacement uses the same authenticated `upload-image` gateway, `site_settings` path swap, and
durable gallery cleanup; raw image bytes and service credentials never enter browser config.

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

## Apply backend changes

For the current customer-access repair, follow
`docs/operations/CUSTOMER_ACCESS_REPAIR_2026-09-10.md`. Apply only its reviewed migrations; deploy
Edge before the Worker/frontend. `PUBLIC_BOOKING_GATEWAY_ROLLOUT.md` records the earlier gateway
rollout and must not be replayed as a current deployment checklist.

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

Cloudflare Worker also needs `SUPABASE_ANON_KEY` as a secret so initial HTML, JSON-LD, and
`/llms.txt` use current public CMS data:

```bash
printf '%s' '<public-anon-key>' | npx wrangler secret put SUPABASE_ANON_KEY
```

The Worker customer proxy also needs the same high-entropy `CUSTOMER_GATEWAY_SECRET` value that the
`public-booking-actions` Edge Function uses. Missing or mismatched values fail closed; deploy both
values with the Worker/Edge change.

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

Public signup remains disabled. Owner creates barber accounts from admin. Each barber receives a
single-use invitation and sets a personal password before first login. Password reset email uses
Supabase Auth through Resend.

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

Production smoke test:

1. Book a test slot with a real test email and phone.
2. Confirm customer and linked barber each receive one email.
3. Follow the random root-path customer link; confirm it opens **Mina bokningar** through the Worker
   redirect and establishes a first-party HttpOnly session.
4. Request a fresh link using email only; confirm the previous link reports replacement/expiry.
5. Cancel the booking and confirm it disappears from upcoming bookings.
6. After appointment time, confirm review eligibility uses the same phone.

## Free-tier operations

Supabase Free has no production backup guarantee. GitHub workflow `database-backup.yml` creates an
encrypted daily database-and-Storage artifact with migration lineage and byte verification only after
all repository secrets/variables are configured. The 2026-09-10 launch audit recorded scheduled runs
failing at configuration validation because `SUPABASE_DB_URL` is still missing. Setup and restore drills
are documented in `docs/operations/BACKUP_RESTORE.md`; keep migrations in source control and never
upload plaintext dumps.

## Mock fallback

If both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are blank at build time, frontend uses local
mock adapters and persists nothing. Production must always build with both values present.
