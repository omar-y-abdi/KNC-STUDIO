# Public booking gateway rollout

This release removes anonymous browser access to contact-keyed booking RPCs. Deploy in the order
below. Never run the contract migration before the switched Worker has passed live gateway checks.

## Cross-PR customer-access dependency

The `20260831222332_customer_access_outbox_ciphertext.sql` migration in PR #55 redefines the
five-argument `create_customer_booking_access_request` compatibility signature so its queued
payload is identifier-only. Merge/deploy PR #55 before database PR #48. Apply the migration and
deploy the matching `external-cleanup` and `public-booking-actions` Edge versions, then verify the
identifier-only queue and successful challenge consumption before applying the database PR #48
migration that drops that retired signature. Applying database PR #48 first is unsafe: applying
PR #55 afterward recreates a function that the final database contract intends to remove.

## Preconditions

- PR validation and encrypted backup workflow are green.
- `npx supabase migration list --linked` shows no remote migration after `20260812112939`.
- Edge Function secrets are present, including `TURNSTILE_SECRET`, `IP_SALT`,
  `PUBLIC_ACTION_HASH_SALT`, `PUBLIC_SITE_ORIGINS`, `RESEND_API_KEY`, and `WEBHOOK_SECRET`.
- Database Vault contains `booking_confirmation_url`, `external_cleanup_url`, and
  `booking_webhook_secret`. The booking-email and external-action dispatchers read that same value
  from Vault; `send-confirmation` and `external-cleanup` accept it as `WEBHOOK_SECRET`.
- Legacy Edge secret `BOOKING_WEBHOOK_SECRET` is absent; `send-confirmation` must not accept an
  unchecked second credential.
- Cloudflare Worker secret `SUPABASE_ANON_KEY` is present. `SUPABASE_URL` is the public Worker
  variable in `wrangler.jsonc`.
- `PROJECT_REF`, `DATABASE_URL`, and production frontend build variables are available in the
  operator shell. Non-interactive Edge deployment also requires a Supabase management
  `SUPABASE_ACCESS_TOKEN`; an interactive operator may instead authenticate the CLI with
  `supabase login`. Never write secret values to this repository.

Verify required Edge Function and database Vault secret names, reject legacy aliases, and confirm
shared webhook-secret parity before function deployment; values/digests are never printed:

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
  calendar-disconnect calendar-oauth-callback calendar-oauth-start \
  external-cleanup public-booking-actions send-confirmation send-email-change \
  send-recovery-email submit-booking; do
  npx supabase functions deploy "$function" --project-ref "$PROJECT_REF" --use-api
done
npx supabase functions deploy upload-image --project-ref "$PROJECT_REF"
npx supabase functions list --project-ref "$PROJECT_REF"
```

Verify `submit-booking`, `public-booking-actions`, `send-confirmation`, `external-cleanup`,
`admin-create-barber`, `admin-manage-barber`, and `upload-image` are deployed. `external-cleanup`
is the durable Calendar create/update/delete/disconnect executor.

The forward-only migration `20260901213117_retire_legacy_calendar_sync.sql` drops the legacy
`calendar_sync_on_bookings` trigger only after checking the durable Calendar trigger, queue, outbox,
and dispatcher are present. The repository ships no compatibility handler after this migration.

After the migration is deployed, prove the trigger retirement and durable path with a read-only
query before deleting the already-deployed compatibility function:

```bash
npx supabase db query --linked --project-ref "$PROJECT_REF" --output-format json \
  "select
     exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.bookings'::regclass
         and tgname = 'booking_calendar_sync_on_change'
         and not tgisinternal
     ) as durable_trigger_present,
     not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.bookings'::regclass
         and tgname = 'calendar_sync_on_bookings'
         and not tgisinternal
     ) as legacy_trigger_absent,
     to_regprocedure('public.queue_calendar_event_sync(uuid)') is not null
       as durable_queue_present,
     to_regclass('public.external_action_jobs') is not null as outbox_present"
```

Continue only when all four returned fields are `true`, then remove the hosted function and read
back the function list. Deleting the local directory does not remove an already-deployed function:

```bash
npx supabase functions delete calendar-sync --project-ref "$PROJECT_REF" --yes
npx supabase functions list --project-ref "$PROJECT_REF" --output-format json \
  | jq -e 'all(.functions[]; .slug != "calendar-sync")'
```

Only after the function-list readback proves that the hosted function is absent, coordinate one
maintenance window to rotate canonical Edge `WEBHOOK_SECRET` and Vault `booking_webhook_secret`
together. Run `PROJECT_REF="$PROJECT_REF" npm run verify:production-secrets` to prove Edge/Vault
parity without printing values or digests. These production deployment, function deletion, secret
rotation, and parity steps are operator actions; repository tests do not claim that live retirement
or rotation has happened.

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

Calendar create/update correctness must be verified through the durable
`booking_calendar_sync_on_change` trigger → `calendar_event_sync` outbox action →
`external-cleanup` path. After the retirement migration is deployed, verify that
`calendar_sync_on_bookings` is absent and that a confirmed booking still creates one deduplicated
`calendar_event_sync` job. Production deployment, canonical `WEBHOOK_SECRET` rotation, and
Edge/Vault parity verification are action-time operator steps; this repository change does not
perform or claim them.

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

After deploying any later function-privilege hardening migration, run the matching pgTAP file against
the linked database and inspect hosted-only `rls_auto_enable()` explicitly; local pgTAP marks those
three assertions as skipped because the function is absent locally:

```bash
npx supabase test db --linked supabase/tests/41_internal_function_privilege_hardening_test.sql
npx supabase db query --linked --project-ref "$PROJECT_REF" --output-format json \
  "select proacl::text from pg_proc where oid = to_regprocedure('public.rls_auto_enable()');"
```

The linked pgTAP run must pass and the ACL must not contain `anon`, `authenticated`, or
`service_role` execute grants before rollout is recorded complete.

## Rollback boundary

Before contract, roll back only frontend or Edge deployment; legacy RPC clients still work. After
contract, restore frontend/Edge first. Regranting direct anonymous RPC access is an emergency-only
security rollback and must be time-boxed, documented, and followed by the contract migration again.
