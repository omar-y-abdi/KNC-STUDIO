# Backend and security review — PR #90 rescue

## Review contract and frozen refs

- Reviewer 2/6; read-only product review. No production calls, deployments, remote writes, repository edits, or branch changes.
- Checkout: `/tmp/knc-pr90`; base `f15b79b5131848d43e888e9841d14a7d71d50177`; head `aadb123dcd19d412a357a8e83ffc7603f3d55b0c`.
- Scope: all changed Supabase functions/config/migrations, auth/access control, request boundaries, booking integrity/idempotency, email/external effects, retention, shared validators and public backend adapters. Surrounding code and relevant tests included where needed to establish impact.
- Supabase skill read. No AGENTS.md found in checkout. Current documentation fetch attempted; search tool cannot fetch markdown MIME, so HTML fallback required.

## Tasks

- [x] Freeze scope and establish living evidence document.
- [x] Inventory changed paths and group security boundaries.
- [x] Review edge request parsing, authorization, external effects and public adapters against base.
- [x] Review each new migration and its replaced definitions, grants, triggers, dependency/order and rollback compatibility (SQL execution still required).
- [x] Validate suspected regressions with isolated reproductions or precise caller/DB tracing.
- [x] Record verified findings, pre-existing issues, rejected hypotheses and explicit changed-path coverage (75/75 assigned paths).
- [x] Report minimal repair/test prerequisites to coordinator.

## Findings

**One verified P2 finding: B-01, old supported CSS escapes can lose their final deletion protection when new revision pruning runs.** No verified new authentication/booking privilege bypass. See the finding and PostgreSQL proof below.

## Investigation log

- Initial inventory: 4 added migrations; changed/new request schemas across 10 Edge Functions; shared HTTP helper and public REST/realtime API split. Baseline contains a substantial pre-existing authorization and durable-action system requiring comparison before attributing regressions.

## Rejected hypotheses / pre-existing conditions

Pending.

## Coverage ledger

Pending explicit path-by-path disposition.

## Verification prerequisites and limitations

- Coordinator owns dependency installation; reviewer will not install npm dependencies.
- Local Supabase/Docker availability not yet established. No production database access is authorized.
- Any database or function execution must use a disposable local environment only.

## Checkpoint 2026-10-27 (phase 1 in progress)

### Completed boundary traces

- All changed Edge handler diffs and all 10 added `request.ts` schemas inspected. Owner/admin handlers retain verified `auth.getUser` and database profile checks; management mutation calls remain caller-scoped. No added trust in `user_metadata`, client actor identifiers, or service keys exposed to public code.
- `submit-booking` now requires the unchanged HMAC gateway verifier before parsing; browser adapter already uses the Worker `/api/bookings` relay. Existing server-side Turnstile, salts and `create_booking_with_limits` remain. No commercial booking values move to client authority.
- `public-booking-actions` request normalization, cookie handling, verified email scope, action rate limits and RPC selection match base. Strict schemas reject extra keys; actual current callers carry the accepted keys.
- Email functions keep webhook-secret or caller auth before external actions. `send-confirmation` intentionally drops wrapper-envelope compatibility; current SQL dispatchers use flat delivery IDs/reminder bodies. No repository caller of the dropped format found.
- `external-cleanup` uses one generic dispatcher now; baseline migration `20260913131739_verified_customer_profiles.sql:508+` already delegates Calendar jobs to `calendar_external_action_for_dispatch`. Removed fallback does not drop the current Calendar contract. Settlement helper preserves side-effect/complete/fail/block order and dispatch-token checks.
- Upload authorization, per-barber ownership, immutable unique object naming, image decoding and retention checks remain. `cmsRetention` is stricter: missing retention RPC now fails closed.
- Public adapters use anonymous PostgREST/realtime split, same data projection/RPC calls, and legacy JWT vs opaque apikey headers. Object URL parity tested against installed Supabase SDK. Admin session client remains distinct.
- Shared email-design and primitive extraction retains validation. `iso-timestamp` preserves historical v3 accepted wire language. Public name/phone/email/review validators have comprehensive parity checks and passed.

### Migrations inspected

- `20261024010000_stop_orphan_sweeper.sql`: per-minute durable-action dispatcher body preserved except orphan scan; daily scan skips all registered inventory; pending retained deletions removed; active dispatch tokens preserved. Prior CMS upload registration/retention semantics support skipping registered objects. No grant widening; CREATE OR REPLACE preserves existing ACLs.
- `20261024043000_cms_conflicts_and_archived_media.sql`: backfills request fingerprints before dropping copies; exact replay checks actor+canonical request hash; PT409/PT422 path mapped in Edge. New SECURITY DEFINER helpers revoke browser/public execute; only actor-checking service RPC is granted. Archived-markup rule deliberately broadens identity to asset-level across head, while structured references retain placement identity.
- `20261024140500_cms_publish_single_pass_and_retention.sql`: writer remains service-only with owner/operational-boundary checks, row/table locks, stale fingerprint, media rule, exact staff membership and atomic writes. 30-day pruning locks in publisher order, preserves head/newest and cascades only revision media index. Further adversarial inspection underway for already stored encoded markup and media index divergence.
- `20261025100000_retire_dead_functions.sql`: `rg` found no active code/policy callers for dropped Calendar compatibility functions, obsolete CMS extractor or `current_role()`. Current conditional Calendar record/exact-identity forget remain. Older function bodies exist in migration history only; later definitions replace their callers.

### Executed verification

At frozen head `aadb123dcd19d412a357a8e83ffc7603f3d55b0c`:

```
npx vitest run tests/unit/edgeContracts.test.ts tests/unit/edgeRequestParsers.test.ts tests/unit/externalActions.test.ts tests/unit/externalActionSettlement.test.ts tests/unit/cmsMediaRetention.test.ts tests/unit/cmsCanonicalResource.test.ts tests/unit/cmsNativeSecurity.test.ts tests/unit/validationParity.test.ts tests/unit/publicApi.test.ts tests/unit/publicRest.test.ts tests/unit/cmsAssetCopy.test.ts
```

Exit 0; 11 files, 302 tests passed (2.42 s). Root independently reports full 1715-test suite, typecheck/build/lint/budget passing.

No Docker, Deno, postgres, initdb or psql executable found locally. Full SQL migration/pgTAP and real Edge bundling remain CI prerequisites; source inspection alone does not prove migration execution.

### Rejected hypotheses so far

- Generic external-action lookup no longer supplies Calendar context: rejected by baseline dispatcher delegation.
- Shared `uuid = z.guid()` opens a privilege boundary: rejected; broader UUID version/variant shape does not bypass server-side ownership, identities or action dispatch tokens; database UUID input is already shape-based.
- Removing `current_role()` execute breaks current RLS: no active policies/callers found; `is_owner`, `is_barber` and `current_barber_id` use their own current profile checks.
- Sweeper stops deleting registered upload garbage: pre-existing CMS retention intentionally retains every registry row; previous sweeper only created repeated no-op jobs.
- Public clients leak staff credentials: new public client is explicitly anon; admin persistence remains in separate client.
- Plain frontend validators silently weaken email/phone contract: existing >100k-input parity test + focused run pass.

### Open hypotheses (not findings)

1. Pruning old revision media indices may unlock explicit deletion of an asset still used by a previously accepted encoded CSS/native reference that the SQL extractor cannot see. Need base-validator reproduction and source/SQL trace of prune+delete.
2. Single-pass publisher removes second owner check after table locks. This enlarges the revocation race window, but no demonstrated exploit or defined immediate-revocation contract yet; do not automatically label as a regression requiring repair.

### Rollout/rollback compatibility notes

- New CMS Edge expects `internal_cms_check_media` and PT409/PT422 codes from database migration; deploying it first or rolling database back can make validation/conflicts fail as temporary server errors. Migration comments specify DB-first rollout and immediate Edge deployment. New SQL remains compatible with baseline successful publish shape, but old Edge maps new conflicts as 503.
- Dropped request-document copies cannot be reconstructed exactly from committed documents; rollback needs restoration of old function bodies using new fingerprints, not blindly rerunning old schema. No automatic rollback migration is provided.
- Calendar removed functions predate baseline's active worker; rollback to frozen main does not call them. Very old historical worker rollback would be incompatible and is outside main/head pair.

## Verified B-01 (P2) — preserve retention protection for supported old CSS escapes

**Status: Verified.** Actual frozen-main/head TypeScript validation plus PostgreSQL 16 reproduction using verbatim production CMS routines confirms the deletion transition. Priority P2 for persisted-data integrity. Requires previously supported encoded content and an owner delete; this is not an unauthenticated exploit or automatic orphan-sweeper deletion.

**Changed location:** `supabase/migrations/20261024140500_cms_publish_single_pass_and_retention.sql:166–187` (new guard and prune). Current asset deletion path: `supabase/migrations/20261024043000_cms_conflicts_and_archived_media.sql:311–322` and `supabase/functions/cms-studio/index.ts:148–170`.

**Baseline evidence:** frozen-main `shared/cms-markup.ts` decodes CSS URL escapes when collecting media references but preserves CSS verbatim; baseline CMS document/media validators accept it when the registered image is active. Baseline `internal_cms_document_media_placements` (`20260918002000_cms_asset_placement_lifecycle.sql:138–159`) only recognizes the literal `/storage/v1/object/public/` prefix. Baseline revision media index (`20260924223012_cms_revision_media_index.sql`) records literal references and prevents hard deletion while any old revision references them. Baseline has no new 30-day CMS pruning job.

**Concrete prerequisites and sequence:**

1. A previously published page references registered `cms-library/images/kept.webp` with a normal canonical URL. That revision has a positive `cms_revision_media` count.
2. A subsequent old-supported publication uses CSS `.hero{background-image:url("https://media.example/st\6frage/v1/object/public/cms-library/images/kept.webp")}`. CSS decodes `\6f` to `o`; the browser still loads the same image. The old complete-document, markup and media validators all accept it, and their canonicalization does not rewrite CSS. The SQL extractor sees zero current references because the raw prefix differs.
3. The raw revision ages beyond 30 days; the encoded one remains the current head. The new guard sees neither its literal storage prefix nor an encoded `/object/publi` suffix, so it does not block pruning.
4. The new prune removes the old revision and its cascaded media index entries. The image remains registered, so orphan sweeping alone does **not** delete it. The relevant consequence is owner-initiated asset deletion: current=0/history=0 lets `internal_cms_asset_transition` accept trash/delete and Edge removes the bytes while the published page still uses them.
5. The new Edge validator rejects future saves of this encoding, but there is no normalization of the already persisted head, so that tightening does not repair this upgrade case.

**Reproduction artifacts (outside product checkout):**

- `/tmp/knc-backend-repro/retention-gap.mjs`: executes frozen-main validation functions and current validator, with assertions that base complete-document/markup/media checks accept, CSS remains byte-for-byte unchanged, current literal extractor finds no references, the new guard (JS mirror) does not block, and current Edge rejects. Exit 0 on 2026-10-27.
- `/tmp/knc-backend-repro/retention-gap.sql`: standalone local pgTAP regression spec after repository migrations, 9 assertions, full rollback, no Storage/network call. It proves the old index protection first, then requires prune to retain it and hard-delete to stay refused. Four final safety assertions are expected to fail on maintenance. Actual PostgreSQL execution now confirms the 4 failures (see execution supplement); the earlier JS regex mirror is supplemental only.

**Minimal repair direction:** extend the fail-closed compatibility guard to inspect the actual JSON-extracted HTML/CSS string values, and retain history whenever those values contain a backslash escape that may conceal a storage prefix. Avoid examining only the JSON-serialized text (ordinary escaped quotes/newline serialization would cause false positives), and avoid writing a full CSS parser in SQL. A conservative guard over raw markup/CSS backslashes will also pause pruning for harmless escaped identifiers/content; document and test that bounded tradeoff, then allow pruning after a normal canonical re-publication. Retain the existing percent/entity checks. Tests must cover old escaped-prefix content, ordinary canonical URLs with quoted HTML, normal multiline CSS, and unrelated non-markup prose containing backslashes. Independent reviewer should assess broader entity-encoded prefix cases and whether the narrow guard is sufficient.

## Pre-existing conditions, not accepted PR regressions

- The pre-existing SQL placement extractor does not decode CSS/native metadata escapes. B-01 concerns the new removal of an old revision that previously protected an asset, not attribution of that old extractor weakness to this PR.
- `admin-create-barber` checks current role/account-enabled but does not include `must_change_password`; `upload-image` also selects only role/barber/account-enabled before its non-CMS operations. These checks are identical in frozen main and head. CMS-specific APIs do enforce the forced-password gate. No new bypass was introduced by the parser refactor; do not silently widen rescue scope from this observation.
- The single-pass publisher no longer repeats owner authorization after taking content table locks. Revocation occurring while the first owner-approved call waits can therefore proceed farther than base. A second check would still have its own revocation race without profile-row serialization. This is recorded for adversarial review, not accepted as a verified exploit or mandatory fix.

## Explicit changed-path coverage — 75 assigned paths

Every row below was read at head and compared to frozen main (added files read directly); related callable boundaries traced as described above. “Reviewed” is source-review coverage, not a claim that SQL or real Deno execution ran. SQL/Edge integration prerequisites remain open.

| Path                                                                           | Disposition                                                                                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/cms-email.ts`                                                          | Reviewed extraction/validation/wire parity; no privilege or validation loss found; focused shared-contract checks pass.                                              |
| `shared/cms-primitives.ts`                                                     | Reviewed extraction/validation/wire parity; no privilege or validation loss found; focused shared-contract checks pass.                                              |
| `shared/cms.ts`                                                                | Reviewed extraction/validation/wire parity; no privilege or validation loss found; focused shared-contract checks pass.                                              |
| `shared/email-design.ts`                                                       | Reviewed extraction/validation/wire parity; no privilege or validation loss found; focused shared-contract checks pass.                                              |
| `shared/email-render.ts`                                                       | Reviewed extraction/validation/wire parity; no privilege or validation loss found; focused shared-contract checks pass.                                              |
| `shared/iso-timestamp.ts`                                                      | Reviewed extraction/validation/wire parity; no privilege or validation loss found; focused shared-contract checks pass.                                              |
| `src/about/reviewValidation.ts`                                                | Reviewed schema/plain-function parity and actual consumers; focused validator tests pass.                                                                            |
| `src/admin/adapters/barbersAdmin.ts`                                           | Reviewed repeated select columns extracted to identical constant; no query/privilege change.                                                                         |
| `src/admin/adminSchemas.ts`                                                    | Reviewed schema/plain-function parity and actual consumers; focused validator tests pass.                                                                            |
| `src/backend/publicApi.ts`                                                     | Reviewed anonymous REST/realtime separation and response/caller contract; no credential or booking-authority leak; focused checks pass.                              |
| `src/backend/publicRealtime.ts`                                                | Reviewed anonymous REST/realtime separation and response/caller contract; no credential or booking-authority leak; focused checks pass.                              |
| `src/backend/publicRest.ts`                                                    | Reviewed anonymous REST/realtime separation and response/caller contract; no credential or booking-authority leak; focused checks pass.                              |
| `src/backend/rpcSchemas.ts`                                                    | Reviewed anonymous REST/realtime separation and response/caller contract; no credential or booking-authority leak; focused checks pass.                              |
| `src/backend/supabaseClient.ts`                                                | Reviewed anonymous REST/realtime separation and response/caller contract; no credential or booking-authority leak; focused checks pass.                              |
| `src/booking/adapters/supabaseBooking.ts`                                      | Reviewed anonymous REST/realtime separation and response/caller contract; no credential or booking-authority leak; focused checks pass.                              |
| `src/booking/adapters/supabaseBookingCatalog.ts`                               | Reviewed anonymous REST/realtime separation and response/caller contract; no credential or booking-authority leak; focused checks pass.                              |
| `src/booking/domain.ts`                                                        | Reviewed unused type removal only; no runtime behavior change.                                                                                                       |
| `src/booking/validation.ts`                                                    | Reviewed schema/plain-function parity and actual consumers; focused validator tests pass.                                                                            |
| `supabase/config.toml`                                                         | Reviewed docs/config-only deltas; signed gateway and deployment references match current callers.                                                                    |
| `supabase/functions/_shared/cmsRetention.ts`                                   | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/_shared/email.ts`                                          | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/_shared/externalActions.ts`                                | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/_shared/http.ts`                                           | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/admin-create-barber/deno.json`                             | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/admin-create-barber/index.ts`                              | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/admin-create-barber/request.ts`                            | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/admin-manage-barber/deno.json`                             | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/admin-manage-barber/index.ts`                              | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/admin-manage-barber/request.ts`                            | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/cms-studio/copyAsset.ts`                                   | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/cms-studio/deno.json`                                      | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/cms-studio/index.ts`                                       | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/cms-studio/request.ts`                                     | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/deno.json`                                                 | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/deno.lock`                                                 | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/external-cleanup/deno.json`                                | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/external-cleanup/index.ts`                                 | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/external-cleanup/request.ts`                               | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/public-booking-actions/README.md`                          | Reviewed docs/config-only deltas; signed gateway and deployment references match current callers.                                                                    |
| `supabase/functions/public-booking-actions/deno.json`                          | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/public-booking-actions/index.ts`                           | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/public-booking-actions/request.ts`                         | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/send-confirmation/README.md`                               | Reviewed docs/config-only deltas; signed gateway and deployment references match current callers.                                                                    |
| `supabase/functions/send-confirmation/deno.json`                               | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/send-confirmation/index.ts`                                | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/send-confirmation/request.ts`                              | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/send-email-change/deno.json`                               | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/send-email-change/index.ts`                                | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/send-email-change/request.ts`                              | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/send-recovery-email/deno.json`                             | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/send-recovery-email/index.ts`                              | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/send-recovery-email/request.ts`                            | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/submit-booking/README.md`                                  | Reviewed docs/config-only deltas; signed gateway and deployment references match current callers.                                                                    |
| `supabase/functions/submit-booking/deno.json`                                  | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/submit-booking/index.ts`                                   | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/submit-booking/request.ts`                                 | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/upload-image/cmsUpload.ts`                                 | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/upload-image/deno.json`                                    | Reviewed pinned imports and local map reachability; edgeContracts pass; real Deno/Edge bundling deferred to CI.                                                      |
| `supabase/functions/upload-image/index.ts`                                     | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/functions/upload-image/request.ts`                                   | Reviewed handler/schema/helper delta with auth, caller/DB ownership and external-effect boundaries; focused checks pass.                                             |
| `supabase/migrations/20261024010000_stop_orphan_sweeper.sql`                   | Reviewed full migration, prior definitions, grants and active callers; no other verified regression; pgTAP pending.                                                  |
| `supabase/migrations/20261024043000_cms_conflicts_and_archived_media.sql`      | Reviewed full migration, prior definitions, grants and active callers; no other verified regression; pgTAP pending.                                                  |
| `supabase/migrations/20261024140500_cms_publish_single_pass_and_retention.sql` | Reviewed writer consolidation, grants, locks, retention and rollback; B-01 verified by PostgreSQL reproduction; complete full-stack migration suite remains pending. |
| `supabase/migrations/20261025100000_retire_dead_functions.sql`                 | Reviewed full migration, prior definitions, grants and active callers; no other verified regression; pgTAP pending.                                                  |
| `supabase/tests/26_calendar_sync_test.sql`                                     | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/31_staff_account_lifecycle_test.sql`                           | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/32_transactional_availability_test.sql`                        | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/33_storage_deletion_outbox_test.sql`                           | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/36_recurring_service_availability_test.sql`                    | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/49_calendar_reassignment_test.sql`                             | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/50_unified_cms_test.sql`                                       | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/64_stop_orphan_sweeper_test.sql`                               | Reviewed all 31 assertions for scheduled dispatch, registered/orphan separation, token preservation and grants; execution pending.                                   |
| `supabase/tests/65_cms_conflicts_and_archived_media_test.sql`                  | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |
| `supabase/tests/66_cms_publish_single_pass_and_retention_test.sql`             | Reviewed all 82 retention/publish assertions; missing supported escaped-prefix upgrade case recorded as B-01.                                                        |
| `supabase/tests/68_dead_function_cleanup_test.sql`                             | Reviewed added/changed assertions against active SQL contracts; retired compatibility tests correspond to dropped APIs; execution pending.                           |

### Additional changed contracts reviewed with other owners

- `shared/cms-markup.ts`: full security-affecting diff and base implementation, including strict storage spelling, CSS/SVG reference validation, native metadata checks and SQL-visible reference subset. Supports future content safety but does not normalize persisted content (B-01).
- `src/about/content/supabaseAboutContent.ts`, `src/about/gallery/supabaseGallery.ts`, `src/about/reviews/adapters/supabaseReviews.ts`, `src/site/adapters/supabaseSiteChrome.ts`: anonymous-read/client split reviewed; selected fields/filter semantics preserved; readonly realtime behavior and cancellation reviewed.
- `src/admin/auth.ts`, admin client setup, `_shared/customerGatewayAuth.ts`, customer cookie/token code, relevant historical RLS/booking/calendar/media migrations: surrounding unchanged authorization/identity contracts traced.
- Read and executed changed unit contracts: `tests/unit/edgeContracts.test.ts`, `tests/unit/edgeRequestParsers.test.ts`, `tests/unit/externalActions.test.ts`, `tests/unit/externalActionSettlement.test.ts`, `tests/unit/cmsMediaRetention.test.ts`, `tests/unit/cmsCanonicalResource.test.ts`, `tests/unit/cmsNativeSecurity.test.ts`, `tests/unit/validationParity.test.ts`, `tests/unit/publicApi.test.ts`, `tests/unit/publicRest.test.ts`, `tests/unit/cmsAssetCopy.test.ts`.
- `tests/unit/validationParity.test.ts` uses the historical `zod/v3` oracle explicitly; production schemas use patched v4. This is intentional compatibility verification, not production downgrade.

### Primary documentation checked

- Supabase changelog: https://supabase.com/changelog (2026-10-27); relevant recent TLS deprecation does not change this PR's auth/SQL contracts. Markdown endpoint fetch was unsupported by search tool; HTML fallback succeeded.
- Supabase RLS guide: https://supabase.com/docs/guides/database/postgres/row-level-security (table privileges and row policy are separate; both reviewed).
- Supabase Edge auth guide: https://supabase.com/docs/guides/functions/auth (caller JWT verification and service-role scope; custom existing verifier/profile checks traced rather than assuming gateway JWT equals authorization).

## PostgreSQL execution supplement — B-01 verified

Coordinator supplied a disposable PostgreSQL 16 cluster with pgTAP, socket `/tmp/knc-pgsocket`, port 55432, no production connection. Reviewer created the isolated `knc_backend_review` database.

`/tmp/knc-backend-repro/minimal-cms-fixture.sql` contains the actual production table definitions for the CMS site/assets/revisions/media index and these verbatim production routines: owner assertion, complete snapshot assembly, state, retained-media lookup, placement extractor, revision-index trigger, asset usage, newly-placed-media rule, media assertion, asset transition/finalize, single-pass publisher, and prune. Unrelated auth/operational tables are skeletal to satisfy the actual snapshot/publication SQL. No stub replaces any function involved in the media retention or deletion decision. No Supabase Auth, Storage HTTP, cron, vault or pg_net service is involved; no full Supabase integration claim is made.

Executed:

```
/usr/lib/postgresql/16/bin/psql -h /tmp/knc-pgsocket -p 55432 -U postgres -d knc_backend_review -v ON_ERROR_STOP=1 -f /tmp/knc-backend-repro/minimal-cms-fixture.sql -f /tmp/knc-backend-repro/retention-gap.sql
```

Observed actual PostgreSQL outcomes:

- Assertions 1–5 PASS: raw historical publication has an indexed reference; encoded current head has zero SQL-visible references; historical references remain positive; owner can trash; hard delete is refused with SQLSTATE 23514 before pruning.
- Assertion 6 FAILS: `prune_cms_revisions()` returns **2**, expected fail-closed **0** (initial snapshot and old raw snapshot pruned).
- Assertions 7–8 FAIL: old raw revision is gone; history reference count no longer protects the current image.
- Assertion 9 FAILS: identical hard-delete request **throws no exception**, expected 23514. Edge proceeds directly from that accepted transition to `storage.remove` (`cms-studio/index.ts:170`). The reproduction stops at the claim and rolls the transaction back; it never deletes bytes.
- pgTAP reports `Looks like you failed 4 tests of 9`. psql process exit 0 means the script executed, **not** that tests passed. This expected failing safety oracle demonstrates the bug.
- Full result: `/tmp/knc-backend-repro/retention-gap-pg16.log`.

Baseline supporting locations: `shared/cms-markup.ts:177–181` decodes the CSS URL before resolving its media reference, while `validateMarkup` only returns canonicalized HTML; CSS remains unchanged. Base `20260924223012_cms_revision_media_index.sql:81–92` checks current placements plus retained-history count before allowing delete. That old safety remains effective until the new pruning job removes its last indexed snapshot.

## Phase 1 disposition and handoff

- **Accepted for independent challenge/repair:** B-01, P2, reproduced in real PostgreSQL.
- **No other accepted backend regression.** Auth/profile checks, booking rate/transaction authority, email dispatch authorization/idempotency, upload ownership and active SQL grants were retained in the inspected deltas.
- **75/75 assigned changed paths reviewed.** Additional shared markup, public adapters and 11 relevant unit contracts reviewed as listed above.
- **Tests executed:** focused 302 tests pass; old/new validation reproduction passes; PostgreSQL failing safety oracle confirms B-01. Root reports whole unit/typecheck/build/lint/budget pass separately.
- **Remaining required verification:** full Supabase migration reset + pgTAP, real Edge import/build/check, patched B-01 regression pass, and independent review of the conservative compatibility guard. Minimal PostgreSQL fixture is sufficient for this specific bug but does not validate all platform extensions, service privileges, realtime or migration rollout.
- **Recommended fix scope:** create a new additive migration with `supabase migration new` (do not edit already-applied historical migrations), then fail closed on legacy escaped rendered markup/CSS in the prune; retain normal multiline CSS/HTML-quoted pruning; do not build a second CSS parser or rewrite existing content silently. Keep old encoded-head fixture as the regression test and verify pruning resumes once the owner publishes canonical content.
- No product file, branch, deployment, production DB, remote comment or external message was changed. Repository `git status --short` remained clean at handoff.

## Implementation contract — B-01 and B-02

Authorized after the 447-path review map closed. Worktree `/tmp/knc-pr90-repair`, branch `fix/pr90-reviewed-maintenance`, initial commit `49f0fbd8c24403dc2f1717c58d3212ac9202b509`. Only this document remains the backend workstream's living plan. QDD/Ralph/minimal-change skills applied; scope and acceptance were explicitly settled by the coordinator, so no repeated approval gate or separate plan is needed.

### Acceptance and tasks

- [x] Add focused pgTAP retention cases: prior supported CSS escapes and raw/percent-encoded dot segments in prefix/path retain historical pins; all page language/mode variants and regions covered; canonical quoted/multiline markup and unrelated prose still prune; harmless authored CSS escapes conservatively pause pruning without a promise that automatic republication removes them.
- [x] Add deterministic integration tests for three owner revocations while publication waits on a real table or site-row lock; observe the wait before revoking; reject with 42501 before replay/writes; cleanup all sessions/transactions in finally.
- [x] Create one new forward migration with Supabase CLI. Replace prune with a conservative guard over actual JSON-extracted rendered markup/CSS strings while retaining old percent/entity checks; restore the post-lock owner assertion after content-table and cms_site-row locks; preserve single-pass snapshot/replay behavior and grants.
- [x] Run red/green verification with actual PostgreSQL routines, targeted pgTAP, TypeScript/lint and the new concurrency test. Record minimal-fixture limits; full Supabase CI remains the platform gate.
- [x] Refresh the backend release stamp if its documented content inputs require it, verify exact changed files, and hand off to coordinator without staging/committing.

### Design decisions

- B-01: conservative detection rather than an additional CSS parser. Inspect rendered page/region source string values, never all JSON serialization or unrelated prose. Backslashes and dot-segment spellings can hide literal SQL references. Existing percent/entity checks remain. Stored authored content/history is not rewritten.
- B-02: repeat the existing authority helper once immediately after the final lock wait, before request replay or any mutations. Keep both existing lock order and document-build count.
- Test connection target is a disposable local PostgreSQL/Supabase database only. Product code and SQL will not call production or a linked project during this work.
- Supabase CLI help required a local config-directory write; elevated help succeeded without connecting to a project. `migration new` is the documented file creation command. No migration has been applied to a shared production database.

## Implementation evidence and handoff

B-01 and independently verified B-02 are repaired in a **new forward migration**:
`supabase/migrations/20261027173553_restore_cms_retention_and_owner_guards.sql`.
Supabase CLI `migration new restore_cms_retention_and_owner_guards` created that filename after
`supabase --help`, `supabase migration --help` and `supabase migration new --help`. No applied
historical migration was edited. No production/linked database, remote write or deployment was used.

### What changed

- **B-01:** `prune_cms_revisions()` extracts each page language variant and each region language
  variant using JSON paths, then reads HTML and light/dark CSS string values. An actual source
  backslash or raw/percent-encoded one/two-dot URL segment pauses pruning. This handles CSS escapes,
  line continuations and normalized URL segments before or inside the storage prefix/path without
  building another CSS parser. Ordinary JSON quote/newline escaping and unrelated prose are outside
  that new guard. The earlier conservative percent/entity/prefix checks remain unchanged.
- **B-02:** `internal_cms_publish()` repeats `internal_cms_assert_owner(p_actor)` immediately after
  both the content-table locks and `cms_site` row lock, before exact replay or writes. The initial
  owner check remains. A programmatic body comparison confirms that only this assertion and its
  explanatory comment differ from maintenance; lock order and all other publication logic match.
- The migration is transactional and replaces functions with the same signatures, ownership,
  security-definer/search-path settings, grants, return contracts and existing cron entry point.
  It changes no tables or authored data, so existing frontend/Edge callers remain compatible.
- Conservative tradeoff: harmless authored CSS escapes and dot-segment-looking source content can
  also pause expiry. Republishing unchanged source **does not necessarily resume pruning**. Actual
  unambiguous source must be published before the guard releases old history; nothing silently
  rewrites source or deletes assets.

### Test deliverables (ready for coordinator commit)

- `supabase/tests/69_cms_retention_compatibility_test.sql`: 66 assertions. The causal asset-deletion
  oracle uses the actual publisher, placement/index routines, usage lookup and transition; it proves
  hard deletion stays refused before and after pruning. Matrix probes cover two pages, both
  languages, both CSS modes and HTML, all four supported regions, CSS escape forms, raw/percent/mixed
  dot segments in prefix/path, old percent/entity guards and harmless CSS escape conservatism.
  Canonical quoted HTML, multiline CSS and unrelated prose prune successfully without rewriting
  the head. Matrix heads are explicit persisted-data fixtures because today's publication checks
  reject some older/noncanonical forms; their real revision-index trigger still runs. The main CSS
  escape exploit is published end to end through the real publisher.
- `tests/integration/cmsPublishAuthorization.test.ts`: **12 deterministic tests**: disabled account,
  password reset required and owner demotion, crossed with a content-table or site-row lock, for
  both fresh publication and exact request replay. Each test observes the actual PostgreSQL blocker
  using `pg_blocking_pids`, commits revocation on a third session, then releases the holder and
  requires SQLSTATE 42501 / `CMS owner required`. Publication runs with `service_role` inside a
  transaction that always rolls back. Fixtures and replay rows are removed in `finally`; every
  connection closes. Replay rows are committed request-history fixtures, without changing the site
  head. The suite accepts only a local database target.

### Verification executed

All database execution used isolated `knc_backend_review`, PostgreSQL 16 on the coordinator's
Unix socket `/tmp/knc-pgsocket:55432`. No Storage/network deletion was performed.

| Check                                                       | Before repair                                                                 | After repair                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| New retention pgTAP, 66 assertions                          | 13 pass, **53 expected failures**; causal last-pin/delete assertions fail     | **66/66 pass**, no pgTAP failures                                                                                        |
| Real publisher concurrency, 12 cases                        | **12/12 fail** because revoked owners receive success, including exact replay | **12/12 pass**, all reject 42501 after the observed wait                                                                 |
| Existing pgTAP 66 assertions 1–14                           | Existing contract retained as safety oracle                                   | **14/14 pass**: grants/comment, same lock order, 2 document builds fresh / 0 replay, identity, stale/archived precedence |
| Focused TypeScript check including the new integration file | Normal repository test config covers unit files only                          | **Pass**, strict `tsc` through temporary extending config                                                                |
| New integration file ESLint + Prettier                      | —                                                                             | **Pass**                                                                                                                 |
| `node tools/release/cms-release.mjs check`                  | —                                                                             | **Pass**; no stamp update required                                                                                       |

The focused TypeScript check caught and corrected an overloaded `pg.Client.query` ReturnType
inference issue that ordinary unit-only typechecking would miss. The test now explicitly uses
`Promise<QueryResult<...>>`.

Replay red/green validation temporarily installed the verbatim maintenance publisher only in the
isolated fixture database, then restored the new forward migration in a `finally` block. Tests
completed with the repaired routines installed and no fixture actors/history left behind.

The existing 14-assertion subset is copied from test 66 into a temporary file, changing only its
plan count and omitting an unused outbox helper whose unrelated table is absent from the minimal
fixture. It is not a replacement for the full existing test 66 on Supabase.

Reproduction/evidence files remain in `/tmp/knc-backend-repro/`:
`retention-repair-red.log`, `retention-repair-green.log`, `owner-repair-red.log`,
`owner-repair-green.log`, `single-pass-subset.sql`, `single-pass-subset-green.log`,
`vitest-cms-repair.config.mjs`, `tsconfig-cms-repair.json`, and the earlier actual-routine fixture.
The pgTAP log parser checked planned/passing/failing assertion counts; psql exit 0 alone was never
used as evidence that assertions passed.

The release stamp covers the cms-studio Edge dependency files listed in `tools/release/cms-release.mjs`;
SQL migrations/tests are not stamp inputs. No source input changed in this backend repair, so the
existing stamp stays correct. Only offline `check` ran; remote `verify` was not invoked.

### Remaining platform gate / limitations

- Run the full Supabase reset/migration/pgTAP and integration suites in CI with the real extensions,
  auth triggers, service role grants, Storage, PostgREST and Edge runtime. The local fixture uses real
  CMS routines and tables but skeletal unrelated operational/auth tables; it cannot certify those
  platform services. The new migration itself applied successfully, including ACL statements.
- The coordinator will run the final full frontend/unit/lint/build gates after installing its newly
  patched dependency lockfile. These focused runs used the installed baseline dependency set, as
  requested to avoid an in-flight dependency replacement.
- Independent reviewer 06 should challenge the source guard/false-positive boundary and the location
  of the owner assertion. No staging, commit, branch change or remote action was taken by this agent.

**Backend handoff files:** this plan, the new forward migration, the new pgTAP spec and the new
integration spec. No other backend product file is changed.
