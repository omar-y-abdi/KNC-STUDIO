# Public booking gateway rollout

> **Historical rollout record.** Production already contains this migration sequence through
> `20260905154608_customer_http_only_session.sql`. Keep steps below for audit/rollback context; do not
> run them as current deployment instructions. New changes need a fresh plan from current local,
> linked-database, Edge, and Cloudflare state.

This branch targets a linked database whose gateway contract is already live. The verified remote
migration history includes `20260813123853_contract_public_booking_gateway.sql` and continues through
`20260827170300_harden_internal_function_privileges.sql`. This rollout therefore stages the five
reviewed post-baseline migrations first, verifies the deployed Edge/frontend coexistence, and retires
the three superseded contracts only at the final step.

PR #55 / #42 must be merged and deployed before PR #56. Its
`20260831222332_customer_access_outbox_ciphertext.sql` migration changes the customer-access payload
contract and is staged explicitly with PR #56; PR #56 then retires the old overloads. Applying #56 first
and #55 afterward would recreate a
function that #56 removes. Merge/deploy PR #55 before database PR #48; customer outbox encryption must
exist before database contract retirement. This checkout does not contain #55, so after #55 merges/deploys, rebase this
branch, refresh the linked-baseline evidence and rerun the complete rollout checks. Reverse deployment
of #55 / #42 after #56 is unsupported. PR #54 has the same required post-merge rebase/disclosure gate
described under Rollback boundary.

Calendar sync uses durable `calendar_event_sync` jobs. Remove retired deployment with
`supabase functions delete calendar-sync --project-ref "$PROJECT_REF"` after replacement dispatcher verification.
Verify removal with `npx supabase functions list --project-ref "$PROJECT_REF" --output-format json` and
`jq -e 'all(.functions[]; .slug != "calendar-sync")'`. Retired Dashboard trigger
`calendar_sync_on_bookings` must remain absent. Durable trigger is
`booking_calendar_sync_on_change`; verify Edge/Vault parity before switching traffic.

`calendar-sync` appears below only as retired rollout history. Do not deploy it. Current deployments
must use the migration-owned trigger plus `external-cleanup` dispatcher and verify the retired
function is absent.

Never run an unrestricted `db push`, and never apply a retirement migration before the switched
frontend and the deployed gateway have passed coexistence checks. This runbook is an operational
procedure, not a launch-ready claim; production data and external-provider smoke remain separate
operator gates.

## Preconditions

- PR validation and encrypted backup workflow are green.
- `npx supabase migration list --linked` confirms the current target baseline: the remote history
  contains `20260813123853_contract_public_booking_gateway.sql` and ends at
  `20260827170300_harden_internal_function_privileges.sql` before this rollout. Do not use the old
  `20260812112939` cutoff. If #55 has already been deployed, its migration must also be present and
  this branch must have been rebased before continuing.
- Edge Function secrets are present, including `TURNSTILE_SECRET`, `IP_SALT`,
  `PUBLIC_ACTION_HASH_SALT`, `PUBLIC_SITE_ORIGINS`, `RESEND_API_KEY`, and `WEBHOOK_SECRET`.
- Database Vault contains `booking_confirmation_url`, `external_cleanup_url`, and
  `booking_webhook_secret`. Both Edge webhook handlers read `WEBHOOK_SECRET`; both database
  dispatchers read the same value from Vault key `booking_webhook_secret`.
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

## Shared migration selection

`tools/release/public-booking-migration-stages.sh` is the executable manifest used by both this
runbook and CI. It copies the complete local lineage through the verified remote baseline plus an
explicit reviewed set; it does not copy arbitrary later migrations. The linked read-only preflight
for the Calendar migration found `map_count=1`, `maps_without_token=0`, and
`maps_without_calendar_id=0`. The same read-only join found `mapped_tokens=1` and
`mapped_tokens_without_email=0`, so the same-account repair gate has a non-null legacy identity to
compare. These are evidence only; the rollout performs no production data write during preflight,
and the migration fails closed if the map, token, or account-identity evidence is no longer true.

For the current baseline, the Expand set is exactly:

- `20260831222332_customer_access_outbox_ciphertext.sql`
- `20260831220511_decimal_service_prices_and_duration_contract.sql`
- `20260831221442_service_ordering_contract.sql`
- `20260901013601_calendar_customer_contact_payload.sql`
- `20260901014248_relocate_btree_gist_to_extensions.sql`
- `20260902005645_calendar_reassignment_cleanup.sql`
- `20260905154608_customer_http_only_session.sql`
- `20260902010333_update_confirm_sent_secure_link_copy.sql`

The Contract set adds exactly these three irreversible retirements:

- `20260901011632_retire_taken_slots_contract.sql`
- `20260901011908_retire_legacy_customer_lookup_overloads.sql`
- `20260901012503_retire_superseded_booking_contracts.sql`

The already-applied `20260813123853_contract_public_booking_gateway.sql` remains in the historical
lineage. It is not an Expand exclusion and must not be treated as a pending Contract migration.

## 1. Expand

Create a temporary Supabase worktree from the shared manifest. The source tree remains untouched.

```bash
export PROJECT_REF='<project-ref>'
stage_root="$(mktemp -d)"
trap 'rm -rf "$stage_root"' EXIT
source "$PWD/tools/release/public-booking-migration-stages.sh"
public_booking_stage_migrations expand "$PWD/supabase" "$stage_root/supabase"

npx supabase link --project-ref "$PROJECT_REF" --workdir "$stage_root"
npx supabase db push --linked --dry-run --workdir "$stage_root"
npx supabase db push --linked --yes --workdir "$stage_root"
```

The dry run must show only the eight explicit Expand migrations above as pending after the verified
baseline. The three retirement migrations must not be applied in this phase. The staging harness uses
the same selector and asserts that already-live gateway denial coexists with service-role gateway
execution:

```bash
npx supabase test db --db-url "$DATABASE_URL" \
  tools/release/expand_public_booking_gateway_test.sql
```

The Calendar migrations extend authoritative Calendar source/trigger behavior, add the durable old
barber/calendar/event identity and conditional mapping lifecycle, and do not replace
`external_action_for_dispatch` or change customer-access delivery. The btree-gist migration
is a reviewed schema relocation that preserves the booking overlap constraint. Do not omit either.

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
npx supabase functions list --project-ref "$PROJECT_REF" --output-format json
```

Verify `submit-booking`, `public-booking-actions`, `send-confirmation`, `external-cleanup`,
`admin-create-barber`, `admin-manage-barber`, and `upload-image` are deployed. Verify `calendar-sync`
is absent with the removal check above.

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

Run live gateway smoke checks while the three retirement migrations are still unapplied. In the
`expand` stage the gateway contract is already active, so direct anonymous lookup is denied while the
legacy service-role downstream functions remain available:

```bash
SUPABASE_URL="https://${PROJECT_REF}.supabase.co" \
SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
PUBLIC_BOOKING_STAGE=expand \
node tools/smoke-live.mjs

curl -fsS https://bladeblendstudio.se/ | grep -F 'business-json-ld'
curl -fsS https://bladeblendstudio.se/llms.txt | grep -F '# Blade & Blend Studio'
```

The direct `lookup_booking` smoke check is phase-specific:

- **Expand smoke:** must return HTTP 401 or 403 because the already-live gateway contract denies
  anonymous execution.
- **Contract smoke:** must return HTTP 404 because the retirement migration removes the function
  itself.

The pgTAP retirement readback is authoritative for function absence.

Verify customer confirmation email contains a random root-path URL that opens **Mina bokningar**
directly. Request a fresh link using email only, confirm the prior link reports replacement, load all
bookings scoped to that email, and cancel an eligible booking. Verify another email is neither shown
nor cancellable. Also verify review rejection/success through production UI. Confirm customer
cancellation and Calendar cleanup jobs drain.

Also owner-upload a homepage logo, verify focused and simulated previews before save, verify the public
desktop/mobile hero receives the new processed WebP through Realtime, then replace/remove it and confirm
the prior `gallery/logo/...` object drains through `external_action_jobs`. Edit and remove phone/map in
**Mejl**; send SV and EN test messages and verify omitted links never become unsafe or stale fallback links.

Do not proceed until the switched frontend, deployed Edge Functions, and these live gateway checks
coexist successfully. A production booking, inbox delivery, Google provider behavior, and production
data cleanup are separate operator approvals and are not proven by this repository or CI.

## 5. Contract

Stage the final migration set through the same explicit manifest. `--include-all` is required here
because the three reviewed retirement files are older than the later Expand files. It is safe only
against this staged tree, which contains the verified baseline, the eight explicit Expand migrations,
and the three explicit retirement migrations. Never use it against the source tree or an unrestricted
working directory:

```bash
contract_root="$(mktemp -d)"
trap 'rm -rf "$stage_root" "$contract_root"' EXIT
public_booking_stage_migrations contract "$PWD/supabase" "$contract_root/supabase"

npx supabase link --project-ref "$PROJECT_REF" --workdir "$contract_root"
npx supabase db push --linked --dry-run --include-all --workdir "$contract_root"
```

The staged Contract tree must contain exactly the eight Expand migrations above plus these three
retirements; if anything else is pending, stop and review the linked history and rebase state:

```text
20260901011632_retire_taken_slots_contract.sql
20260901011908_retire_legacy_customer_lookup_overloads.sql
20260901012503_retire_superseded_booking_contracts.sql
```

Only after the dry run matches exactly:

```bash
npx supabase db push --linked --yes --include-all --workdir "$contract_root"
npx supabase test db --db-url "$DATABASE_URL" \
  supabase/tests/34_public_booking_gateway_contract_test.sql
npx supabase test db --db-url "$DATABASE_URL" \
  supabase/tests/44_retire_taken_slots_test.sql
npx supabase test db --db-url "$DATABASE_URL" \
  supabase/tests/45_retire_legacy_customer_lookup_test.sql
npx supabase test db --db-url "$DATABASE_URL" \
  supabase/tests/46_retire_superseded_booking_contract_test.sql
npx supabase test db --db-url "$DATABASE_URL" \
  supabase/tests/47_calendar_customer_contact_test.sql
npx supabase test db --db-url "$DATABASE_URL" \
  supabase/tests/48_btree_gist_relocation_test.sql
```

Re-run the live smoke with `PUBLIC_BOOKING_STAGE=contract`. Gateway requests must still work, direct
anonymous RPC execution must remain denied, and the three retired function families must now be
absent. Record the deployment commit, migration list, function list, Worker version, smoke results,
and UTC completion time in private operations records.

`20260827170300_harden_internal_function_privileges.sql` is already part of the verified baseline, not
a migration deployed by this rollout. Read back its existing privilege result after the staged
database changes and inspect hosted-only `rls_auto_enable()` explicitly; local pgTAP marks those three
assertions as skipped because the function is absent locally:

```bash
npx supabase test db --linked supabase/tests/41_internal_function_privilege_hardening_test.sql
npx supabase db query --linked --project-ref "$PROJECT_REF" --output-format json \
  "select proacl::text from pg_proc where oid = to_regprocedure('public.rls_auto_enable()');"
```

The linked pgTAP run must pass. Operators must read back its existing ACL and confirm it does not
contain `anon`, `authenticated`, or `service_role` execute grants before rollout is recorded complete.

## Rollback boundary

Before the final retirement step, the already-live gateway contract has already denied direct
anonymous clients; only the current secure gateway clients are supported. If a pre-retirement
frontend or Edge artifact must be rolled back, it must still use that gateway contract. After
retirement, old frontend/Edge artifacts cannot be restored first because they may call the dropped
service-role functions. Recovery requires a separately reviewed forward migration that restores only a
secure-gateway-compatible function surface, followed by matching Edge/frontend deployment; recovery
must never regrant anonymous access. The three drops are irreversible. The btree_gist schema move does
not delete data or rebuild the overlap constraint; if rollback is needed, use a separately reviewed forward
`ALTER EXTENSION btree_gist SET SCHEMA public` migration rather than manual drift.

After platform PR #54 merges, rebase this database branch and update every occurrence of the Calendar
privacy disclosure in both Swedish and English sections before opening or refreshing the database PR.
After PR #55 / #42 merges and deploys, rebase this branch onto the resulting main, refresh the linked
migration baseline and rerun the exact Expand/Contract harness before any final rollout decision.
