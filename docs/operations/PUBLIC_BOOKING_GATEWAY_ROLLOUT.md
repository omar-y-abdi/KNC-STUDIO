# Public booking gateway rollout

This release removes anonymous browser access to contact-keyed booking RPCs. Deploy in the order
below. Never run the contract migration before the switched Worker has passed live gateway checks.

## Preconditions

- PR validation and encrypted backup workflow are green.
- `npx supabase migration list --linked` shows no remote migration after `20260812112939`.
- Edge Function secrets are present, including `TURNSTILE_SECRET`, `IP_SALT`,
  `PUBLIC_ACTION_HASH_SALT`, `PUBLIC_SITE_ORIGINS`, `RESEND_API_KEY`, and `WEBHOOK_SECRET`.
- Database Vault contains `booking_confirmation_url`, `external_cleanup_url`, and
  `booking_webhook_secret`. Both Edge webhook handlers read `WEBHOOK_SECRET`; both database
  dispatchers read the same value from Vault key `booking_webhook_secret`.
- Cloudflare Worker secret `SUPABASE_ANON_KEY` is present. `SUPABASE_URL` is the public Worker
  variable in `wrangler.jsonc`.
- `PROJECT_REF`, `DATABASE_URL`, and production frontend build variables are available in the
  operator shell. Never write secret values to this repository.

Verify required secret names before function deployment; values/digests are never printed:

```bash
PROJECT_REF="$PROJECT_REF" npm run verify:production-secrets
```

## 1. Expand

Create a temporary Supabase worktree containing every pending migration except the final contract.
This keeps the source tree untouched and prevents an accidental all-at-once `db push`.

```bash
export PROJECT_REF='<project-ref>'
stage_root="$(mktemp -d)"
trap 'rm -rf "$stage_root"' EXIT
mkdir -p "$stage_root/supabase"
rsync -a --exclude '.temp' supabase/ "$stage_root/supabase/"
rm "$stage_root/supabase/migrations/20260813123853_contract_public_booking_gateway.sql"

npx supabase link --project-ref "$PROJECT_REF" --workdir "$stage_root"
npx supabase db push --linked --dry-run --workdir "$stage_root"
npx supabase db push --linked --yes --workdir "$stage_root"
```

Expected final migration in this phase: `20260824075236_admin_cms_logo_and_contact_controls.sql`
or any later explicitly reviewed expand-safe migration added before release. The older
`20260813123853_contract_public_booking_gateway.sql` is intentionally absent from remote history.
`20260813123851_review_hardening.sql` adds the email-scoped customer access session;
`20260823130000_classify_booking_email_delivery_failures.sql` accepts status codes emitted by the
newly deployed `send-confirmation`.
Do not omit either. Anonymous legacy RPCs and both new and legacy service-role gateway RPCs must
remain executable:

```bash
npx supabase test db --db-url "$DATABASE_URL" \
  tools/release/expand_public_booking_gateway_test.sql
```

## 2. Deploy Edge Functions

Deploy all functions because this migration set also changes email, Calendar, image cleanup, and
staff-account side effects. Do not use `--prune` during this rollout. `upload-image` carries a
static WASM asset, so deploy it with local Docker bundling rather than `--use-api`.

```bash
for function in \
  admin-create-barber admin-manage-barber \
  calendar-disconnect calendar-oauth-callback calendar-oauth-start calendar-sync \
  external-cleanup public-booking-actions send-confirmation send-email-change \
  send-recovery-email submit-booking; do
  npx supabase functions deploy "$function" --project-ref "$PROJECT_REF" --use-api
done
npx supabase functions deploy upload-image --project-ref "$PROJECT_REF"
npx supabase functions list --project-ref "$PROJECT_REF"
```

Verify `submit-booking`, `public-booking-actions`, `send-confirmation`, `calendar-sync`,
`external-cleanup`, `admin-create-barber`, `admin-manage-barber`, and `upload-image` are deployed.

## 3. Switch frontend

Build with production `VITE_` values. Ensure Cloudflare can render current CMS metadata before
traffic switches:

```bash
printf '%s' "$VITE_SUPABASE_ANON_KEY" | npx wrangler secret put SUPABASE_ANON_KEY
npm run deploy
```

The deployed frontend must contain no direct calls to legacy customer-action RPCs. Customer history
and cancellation must call `public-booking-actions` with an opaque access token only:

```bash
! grep -R -E "\\.rpc\\([^)]*(lookup_booking|list_bookings_by_phone|cancel_booking|create_review)" dist
```

## 4. Verify coexistence

Run live gateway smoke checks while legacy RPC access is still available:

```bash
SUPABASE_URL="https://${PROJECT_REF}.supabase.co" \
SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
PUBLIC_BOOKING_STAGE=expand \
node tools/smoke-live.mjs

curl -fsS https://bladeblendstudio.se/ | grep -F 'business-json-ld'
curl -fsS https://bladeblendstudio.se/llms.txt | grep -F '# Blade & Blend Studio'
```

Verify customer confirmation email contains a random root-path URL that opens **Mina bokningar**
directly. Request a fresh link using email only, confirm the prior link reports replacement, load all
bookings scoped to that email, and cancel an eligible booking. Verify another email is neither shown
nor cancellable. Also verify review rejection/success through production UI. Confirm customer
cancellation and Calendar cleanup jobs drain.

Also owner-upload a homepage logo, verify focused and simulated previews before save, verify the public
desktop/mobile hero receives the new processed WebP through Realtime, then replace/remove it and confirm
the prior `gallery/logo/...` object drains through `external_action_jobs`. Edit and remove phone/map in
**Mejl**; send SV and EN test messages and verify omitted links never become unsafe or stale fallback links.

## 5. Contract

Because expand applied later-numbered compatibility migrations while intentionally omitting the
contract, include older local migrations in this dry run:

```bash
npx supabase db push --linked --dry-run --include-all
```

If anything except `20260813123853_contract_public_booking_gateway.sql` appears, stop. Otherwise:

```bash
npx supabase db push --linked --yes --include-all
npx supabase test db --db-url "$DATABASE_URL" \
  supabase/tests/34_public_booking_gateway_contract_test.sql
```

Re-run `tools/smoke-live.mjs` after contract with `PUBLIC_BOOKING_STAGE=contract`. Gateway requests
must still work; direct anonymous RPC execution must now fail. Record deployment commit, migration
list, function list, Worker version, smoke results, and UTC completion time in operations records.

## Rollback boundary

Before contract, roll back only frontend or Edge deployment; legacy RPC clients still work. After
contract, restore frontend/Edge first. Regranting direct anonymous RPC access is an emergency-only
security rollback and must be time-boxed, documented, and followed by the contract migration again.
