# CMS unified editing and resource assignments — implementation plan

> **Current checkpoint:** [Committed PR handoff](../../handoffs/cms-unified-resources-checkpoint.md). R4 is preserved as WIP; older checkpoint states below are chronological, not current acceptance.

> Fresh agent: read this file before changing code. Execute one task at a time using systematic-debugging, test-driven-development and verification-before-completion. Do not infer completion from a green unrelated test. Record exact implementation commits in the ledger below.

## Documentation home (owner instruction)

All working documentation for this task belongs under `/Users/k/dev/barber/project/docs/`.
This file is the canonical plan, findings ledger and resume point. The supporting [E2 resize brief](cms-unified-resources-briefs/E2-brief.md) and [E3 mobile-header brief](cms-unified-resources-briefs/E3-brief.md) are now stored alongside it. Raw logs and screenshots remain separate, untracked evidence; they are not the only record of decisions or progress.
The attempted delegated E2/E3 sessions stopped at the Codex usage limit before implementation; those briefs are instructions, not completion reports. Continue inline, and do not infer any agent-delivered changes from their existence.

## Goal and scope (owner request, 2026-09-24)

Work directly in `/Users/k/dev/barber/project` on the owner's Mac. Make Home/About one continuous editable workspace; make resource categories, upload destinations, reuse and double-click replacement correspond to real website usages; make repeated barber cards resize consistently without clipping; repair new-page mobile chrome. Investigate the uploaded-file error first. Preserve booking/auth/asset lifecycle protections, existing drafts and the approved visual direction.

**Architecture:** Keep the existing Preact/GrapesJS editor, shared document contract and Supabase publication boundary. Home is one editor destination while stored About remains a canonical backward-compatible content owner. Resource assignment changes the draft, not live content; uploading registers a file separately. Repeated presentation groups share geometry, never person-specific content. Historical resource references must not require rescanning every historical HTML document per click.

**Baseline:** clean local HEAD `ff1e8b3a4c49d133e356b472eb3b58e62ca5eced`; PR #77 merged as `f3adf076ac0665c331859ccb0b48da4e9b0c7d31`. Local branch `fix/cms-unified-resources-20260924`; do not push until the requested implementation has accumulated and focused gates pass. Never force-update another branch.

## Confirmed investigation

- Both supplied IDs `03308984-77cc-4c87-b6f7-0164308de793` and screenshot `21f6f110-5917-4b13-ac79-93ae052ccc3a` are `cms_studio_failure`, SQLSTATE **57014**.
- 2026-09-24 14:25:09Z: `upload-image` POST **200**. At 14:25:18Z PostgreSQL cancels `internal_cms_asset_usage` while scanning `cms_revisions` through `internal_cms_document_media_placements`; subsequent `cms-studio` POST **503**. Upload succeeded; reference inspection timed out. Do not change the working image codec or merely raise timeouts.
- `Resources.tsx` purpose dropdown only changes the upload destination; it does not filter `visible`. Upload registers an asset but does not assign it to the draft. Selection automatically invokes the slow usage RPC and reports its failure as a global error.
- `composedCanvas.ts` clones About with `preview-shared-*` IDs and deliberately removes native identities; `editorPolicy.ts` marks descendants of runtime slots read-only. `stripComposedCanvas` discards those edits. This is intentional old architecture, not a missing click handler.
- `site-page.ts` uses desktop header markup for new pages, with only wrap/center mobile overrides. The owner's image shows wrapped contact text and mis-scaled logo.
- The transient white-page/draft collapse is NOT diagnosed. Owner explicitly permits deferring deep investigation if logs do not identify it. No speculative draft reset or broad crash-test project.

## Constraints and review risks

Use small commits with focused failing-then-passing tests. Full sweeps only after substantial production changes. Keep evidence outside tracked source. Do not expose credentials, publish owner CMS content, send test mail, delete backups, or mutate bookings. Mobile and desktop geometry remain independent; light/dark geometry stays consistent. Images/person names are not globally linked merely because their styles are. Asset activation/deactivation is not permanent deletion. Archived/trashed files must never become newly assigned.

## Task ledger (pending until evidence and commit are recorded)

| ID  | Deliverable                                                                   | State                                              | Implementation commit / verification                  |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| R1  | Indexed history reference lookup; no false upload failure                     | Local fixes verified; production migration pending | `ced0b41` (SQL), `2d9f300` (UI retry); commands below |
| E1  | Continuous editable Home/About with lossless save/reload                      | Focused browser pass; extended acceptance pending  | `c250005`; Chromium/WebKit `cms-unified-home.mjs`     |
| E2  | Proportional nested resize and linked barber geometry                         | Pending                                            | Pending                                               |
| R2  | Real resource categories, upload destination dialog, draft assignments/reuse  | Uncommitted work; browser and lint failures remain | No implementation commit yet; see current checkpoint  |
| R3  | Contextual double-click picker for gallery/profile/logo/SVG; no stacked modal | Pending                                            | Pending                                               |
| R4  | Existing built-in resources and component controls visible in Resources       | Pending                                            | Pending                                               |
| E3  | New authored page mobile header layout                                        | Investigated                                       | Pending                                               |

## Task execution details

1. **R1** — inspect the existing lifecycle SQL and local database/test fixture. Add a bounded history-index regression including historical-only references, insert/update/delete maintenance and denied anonymous access. Add a migration with transactional backfill and indexed history counts; preserve current-reference checks and deletion reservations. Test locally before applying an authorized production migration. Separately show usage failure locally with retry, never mislabel a successful upload.
2. **E1** — edit `composedCanvas.ts`, `Editor.tsx`, `Studio.tsx` and their focused browser tests. Retain canonical About native IDs in one visible Home surface; export edits back to About atomically with Home. Preserve inactive device/language data and history. Remove duplicate page navigation, not the public `/about` route. Verify inline text/style, navigation, undo and publication/reload without erasing prior About edits.
3. **E2** — inspect `canvasBehavior.ts`, `responsiveStyles.ts`, native card markup and projection. Introduce the smallest named presentation-group resize behavior needed: derive scale from the selected container, scale child geometry and propagate only matching presentation styles across the repeated barber group. Keep identity, content, events, source metadata and other device geometry unchanged. Verify rendered child bounds and following-section layout, not only model flags.
4. **R2** — add a pure typed assignment/category module and focused unit tests first. Resource categories filter real storage purpose; library retains a reusable bank. Upload dialog selects destination and barber. Activation/reassignment updates the draft using existing contracts; cross-bucket reuse must respect backend scope, using a bounded server copy only if required. No re-upload requirement for ordinary activate/deactivate. Keep late-response and lifecycle race protections.
5. **R3/R4** — share contextual selection logic between Resources and Editor. Double-click opens one picker filtered by target, including photo-less profile placeholders and inline SVG/logo targets. Preserve native callbacks. Expose built-in asset previews and editable component references (contact/map/language/phone) without pretending those controls are uploaded files or enabling unsafe SVG/script uploads.
6. **E3** — give newly created page chrome a responsive baseline that follows mobile layout rather than wrapping desktop fixed widths. Preserve owner overrides, link behavior, themes and existing authored content. Test new page at 390px and desktop plus save/reload.
7. **Integration** — after the above commits: typecheck, changed-file lint/format, related unit suites, Chromium/WebKit focused flows and real local Supabase integration. Run full gates once. Inspect affected screenshots on the Mac. Review the final diff for data loss, stale closures, incorrect identity targeting, hidden clipping and access-control regressions. Push a new remote branch and PR, inspect CI, fix root causes only, then code-review cleanup in separate commits.

## Evidence and handoff discipline

Use `/Users/k/dev/barber/cms-unified-evidence/` for raw logs, SQL plans/results and screenshots, never real credentials or customer data. Record commands, exit codes, commit IDs and whether a test uses intercepted boundaries or a real database. No blanket claim of all bugs fixed. At pause/completion, append the exact next action and uncommitted file state. Each solved ledger entry must name a commit resolvable via `git show <sha>` and a reproducible command.

## Progress 2026-09-24 — R1 database boundary

Implementation **`ced0b41`** introduces `cms_revision_media` (private/RLS), transactional backfill, write-through revision trigger and indexed counts in all three lifecycle/usage RPCs. Local `npx supabase test db supabase/tests/62_cms_revision_media_index_test.sql` passed **12 assertions** after the old code failed the missing-index/no-history-scan contracts. Evidence: `R1-red.log`, `R1-migration.log`, `R1-green.log`. Migration has only been applied to the existing **local** Supabase stack; production still needs this migration after final review.
The adjacent `50_unified_cms_test.sql` assumes an empty initial revision zero; the owner's local stack is already at revision 5. Its baseline assertion failed before the target scenario. No reset or deletion was performed to manufacture a pass. Use an isolated fresh stack for that full suite at integration time. The new index test is transactionally isolated and passes on the populated local stack. The frontend part was subsequently implemented in `2d9f300`; see the next progress entry.

## Resume 2026-09-24 — canonical Home editing

**E1 implementation `c250005`**: Home composes the active device's canonical About tree, exports it atomically to the existing About owner, and preserves the public `/about` route. The duplicate editor destination is removed. `cms-unified-home.mjs` failed on the old code (no editable About tree), then passed in Chromium and WebKit: inline text → device switch → validated publication → reload. Typecheck and changed-file lint/format passed. Evidence: `E1-red.log`, `E1-chromium.log`, `E1-webkit.log`, `E1-types.log`, `E1-lint.log`.
**Remaining E1 acceptance**: extended styles/undo/language preservation plus updating old browser navigation expectations at integration; do not equate this focused pass with a full cross-page acceptance.
**R1 frontend**: the usage-read failure now has a local diagnostic and retry; the selected uploaded file remains present, with no global upload-failure toast. Focused test: `BASE_URL=http://127.0.0.1:4199 node tools/e2e/cms-resource-usage.mjs`. Red timed out on missing retry; green passed. The database migration is still local-only. Implementation commit: `2d9f3009b066228573f11757e2d21180d2c0b077`.

## Current checkpoint — documentation consolidated under docs/

Latest committed implementation: `2d9f3009b066228573f11757e2d21180d2c0b077`. The documentation-location update is documentation-only; it does not complete the remaining product changes.

**R2 work in progress:** typed resource destinations and draft assignments, category filtering, upload destination dialog, gallery activation/deactivation, and server-side cross-bucket asset copying. These source changes are not committed or signed off yet. Review them before extending them; do not reapply an earlier patch.

**Recorded tests, not rerun for this documentation update:**

- `npx vitest run tests/unit/cmsResourceAssignment.test.ts tests/unit/cmsAssetCopy.test.ts`: 9 tests passed in the recorded `R2-core-green.log`.
- `BASE_URL=http://127.0.0.1:4199 node tools/e2e/cms-resource-workflow.mjs`: FAILED. The upload dialog remained visible; its error and the harness error were `Failed to send a request to the Edge Function`. The latest raw log is named `R2-workflow-green.log` despite containing a failure. A filename is not a result.
- `R2-lint.log`: dynamic property deletion errors in `shared/cms-resource-assignment.ts`, interface/type convention in `ResourceUploadDialog.tsx`, and an unused declared global in `cms-resource-workflow.mjs`. The Edge copy module was ignored by that ESLint invocation and still needs its normal Deno/Edge checks.
- `R2-typecheck.log` has no reported diagnostics. Verify the command exit status before claiming a fresh typecheck pass.

**Exact next step:** inspect `tools/e2e/cms-resource-workflow.mjs`, the real `cmsApi` calls and the failed browser request. Establish whether the test's API override is actually intercepting the request. A Vite module-graph/mock mismatch is only a hypothesis; the recorded failure does not prove it. Prefer the existing `cms-adversarial.mjs` network-boundary fixture pattern when reproducing the real request. Do not change production upload logic merely to make a fixture pass. Then correct the listed scoped lint errors and rerun the focused tests.

**Still pending:** complete and verify R2, implement E2/R3/R4/E3, finish E1's extended acceptance, validate new source/API contracts and release stamping, review/apply the authorized production reference-index migration, then accumulated-change integration checks, new remote branch/PR, CI and final code review. No production deployment/publication is claimed for these new changes.

The local E3 browser script is an unfinished scaffold, not a passing regression test. The two delegated briefs produced no implementation because Codex hit its usage limit. Do not overwrite other worktrees or try to bypass that limit.

### Uncommitted product files at this checkpoint

Preserve these existing local edits; this documentation commit does not stage them.

- `shared/cms-resource-assignment.ts`
- `src/admin/cms/ResourceDestination.tsx`
- `src/admin/cms/ResourceUploadDialog.tsx`
- `src/admin/cms/Resources.tsx`
- `src/admin/cms/api.ts`
- `supabase/functions/cms-studio/copyAsset.ts`
- `supabase/functions/cms-studio/index.ts`
- `tests/unit/cmsAssetCopy.test.ts`
- `tests/unit/cmsResourceAssignment.test.ts`
- `tools/e2e/cms-new-page-mobile.mjs`
- `tools/e2e/cms-resource-workflow.mjs`

## Resume — R2 checkpoint committed

**`360baca`** saves category filtering, upload destination/person selection, draft gallery/profile/logo/font assignments, reversible activation, and scoped server-side reuse. Current network-boundary tests pass in Chromium and WebKit (`R2-final-chromium.log`, `R2-final-webkit.log`); scoped lint and typecheck pass, and assignment/copy/release unit tests pass. The reproduction now intercepts real Functions requests and blocks unexpected external destinations. The earlier upload-request failure is not reproducible in this current test; do not attribute its disappearance to a production codec change. Local synthetic Storage responses remove irrelevant `.invalid` image DNS noise.

This is **not yet whole-site acceptance**: existing canvas/locked-preview resource refresh, contextual picking and built-in component controls are R3/R4 work, not proven by the standalone resource test. `asset_copy` needs Edge/runtime validation and deployment before the new frontend can use it. The release dependency list now includes its new module. No production mutation has occurred.

**E3 red recorded** in `E3-red.log`: freshly created phone header has `white-space: normal` on the telephone link. Its responsive header implementation and saved-page browser check are now being completed; no delegated agent is running.

## Resume — 2026-09-25, live state and completed local tasks

- **E3: `f048191`** contains the compact mobile authored-page header and focused browser test. **E2: `be97299`** contains proportional, layout-participating barber scaling and linked peers. Existing evidence is `E2-green.log`, `E2-webkit.log`, `E2-unit.log`, `E2-types.log` and `E2-lint.log`; these commits already exist. Do not reimplement them. Final accumulated-change regression verification remains.
- **R1 production migration applied successfully:** Supabase assigned version `20260924223012` to `cms_revision_media_index`. Before: no index, 33 revisions, 4 assets. After: 66 indexed asset/revision rows; all 33 revisions retained. RLS is enabled; anon/authenticated cannot read the index or execute the internal usage RPC; service_role retains RPC execution. No CMS content, bookings or stored files were changed.
- Fresh local `npx supabase test db supabase/tests/62_cms_revision_media_index_test.sql` passed all 12 assertions (`R1-fresh-index.log`). Production `EXPLAIN ANALYZE` of usage lookup for all four assets completed in **1381.136 ms**, instead of the previously diagnosed history-scan timeout. This is a database read measurement, not an authenticated upload end-to-end claim.
- Align the repository migration filename and the already-applied local migration-history entry with production version `20260924223012` before final push. Do not reapply the DDL in production.
- **R3 root cause:** resource assignment changed domain fields (`photos`/`gallery`/logo) while the editable canvas rendered an older presentation snapshot; locked preview also read public rather than draft resources. Conditional placeholder/image projection dropped newly present images.
- R3 working code now uses read-only draft adapters and captures only Home/About after a resource change. Assignment plus editable layout is one draft transaction with three-way reconciliation against concurrent edits. CSSOM is deliberately not recaptured: it mixes page styles and would grow on each assignment. Only the source-owned mobile barber baseline is replaced; authored CSS remains.
- `R3-render-baseline.log`: reverting only the resource callback to the previous domain-only boundary reproduces the missing image (15-second element wait). `R3-render-green.log`: the same real UI assignment reaches the actual canvas with no publication. The first attempted reproducer had an ambiguous selector matching the inactive-device preview; it was corrected before this red/green comparison. Extended undo/locked-preview and WebKit verification are in progress.
- Remaining: finish R3/R4 contextual image selection and built-in component/resource management; run focused persistence/CSS stability checks, fresh accumulated-change integration, deploy the verified asset_copy backend, push a new remote branch/PR, inspect CI and perform final code review. No final completion or merge recommendation yet.

### R3 draft rendering transaction verified

`cms-draft-resources.mjs` now passes in Chromium and WebKit (`R3-final-chromium.log`, `R3-final-webkit.log`): real resource UI assignment updates the canvas, undo/redo restores data and layout together, and the locked read-only runtime displays the unpublished portrait. The fixture intercepts the backend; it performs no production writes. `R3-unit-final.log` passes 5 targeted preview/native-tree tests; `R3-types-final.log` and `R3-lint-final.log` pass. The accompanying implementation commit is resolvable with `git log --oneline -- src/admin/cms/captureResourceLayouts.ts`.

Next focused test: `cms-contextual-resources.mjs`, initially requiring a real double-click on a photo-less barber placeholder to open the correct person's resource library. This is a distinct user-facing entry point, not covered by the preceding resource assignment test.

### Production migration history aligned

The production index deployment succeeded as `20260924223012`. The SQL file is renamed to that exact version and the already-applied local history is repaired (old local version reverted in bookkeeping, new version marked applied). Both CLI repair commands completed successfully; no DDL was reapplied and no document was removed (`R1-local-history-repair.log`). Source DDL remains the implementation from `ced0b41`.

R3 coherent draft/rendering transaction commit: **`e4b7a17`**. Contextual double-click work is separate and still uncommitted. The initial legacy listener used an event (`component:dblclick`) that the installed GrapesJS does not emit; native iframe delegation is being checked using actual double clicks before committing it.

## Latest checkpoint — contextual picking committed, R4 not integrated

This section supersedes the older checkpoint/table states above. Do not reimplement the already committed tasks.

- **R3 entry point: `c1cb288`** connects actual iframe `dblclick` events to contextual resource destinations. The installed GrapesJS does not emit the former `component:dblclick` event. A double-click on a photo-less barber graphic opens that person's filtered library; assignment closes the contextual resource view after the draft/render transaction completes.
- Fresh focused runs: `continue-cms-contextual-resources-chromium.log`, `continue-cms-contextual-resources-webkit.log`, `continue-cms-draft-resources-chromium.log`, `continue-cms-draft-resources-webkit.log` all reach their PASS assertions. The draft-resource test now also publishes through its intercepted backend and verifies a reload. No production publication occurs. ESLint on all six committed paths passes; `git diff --check` passed before the commit.
- Already committed: R1 SQL `ced0b41` and UI `2d9f300`; canonical Home E1 `c250005`; resource destinations R2 `360baca`; mobile authored header E3 `f048191`; linked hierarchical resize E2 `be97299`; coherent draft/render transaction `e4b7a17`; production migration history alignment `c6b7073`. Broader integration acceptance is still pending.
- **R4 red:** `R4-red.log` reproduces the absent `Webbplatsens resurser` entry point. The current resource screen only enumerates uploaded assets. Source-owned SVGs, controls and built-ins are not represented there.
- New uncommitted R4 files: `shared/cms-site-resources.ts` and `src/admin/cms/SiteResources.tsx`. They are not imported into the application yet. Existing `tools/e2e/cms-site-resources.mjs` remains uncommitted. Do not treat these as a completed feature.
- Fresh typecheck currently FAILS on the R4 drafts: `cms-site-resources.ts:99` assigns a plain namespace string where parse5 requires its `html.NS` enum; `SiteResources.tsx:65` selects a nonexistent `settings` icon instead of an allowed Icon name. No errors were reported for the committed contextual-picker paths.
- A narrowly scoped command to correct those two type errors and capture the input value before its deferred state update was blocked by the tool safety service (`couldn't determine the safety status of the request`). Identical retries also failed. Those edits did NOT execute; no alternative route was used to apply them.

**Next action:** when code writes can be authorized, finish the two local R4 type errors, integrate SiteResources into the resource navigation, complete the existing red browser scenario, and add scoped mutation/projection tests. In particular, generic decorative SVG replacement must be checked against `NativeSurface.tsx` (currently only SVGs with role=img project as replacement images); do not claim every SVG path works from the passing barber-placeholder test. Preserve functional parents and never replace a required graphic's own callbacks.

Then finish gallery/logo/person picker coverage, E1 language/style/undo acceptance, linked-resize and mobile-header regression checks, real local Edge/database asset-copy checks, release stamping/deployment, new remote branch/PR and accumulated CI review. No new remote push, Edge deployment, SQL mutation or content publication happened during this continuation. The production R1 migration was already applied in the earlier recorded step.

## Write-access recheck — 2026-09-25

The owner requested a fresh check of the previously blocked code edits. Ordinary, direct writes to the original `.ts` and `.tsx` files succeeded through Remote Desktop Commander. No extension changes, safety-setting changes or alternate write route were used. This confirms these specific edits are no longer blocked; it does not establish why the previous requests were rejected.

- Before editing, `npm run typecheck` exited **2**, reproducing the two recorded R4 type errors.
- `shared/cms-site-resources.ts`: import parse5's public `html` export and assign `html.NS.HTML` rather than a plain namespace string. The installed enum declares the same HTML namespace value.
- `src/admin/cms/SiteResources.tsx`: use the existing `sliders` icon instead of nonexistent `settings`.
- Read-back assertions confirmed both changes on disk. After the changes, `npm run typecheck` exited **0** with no diagnostics.

These two adjustments remain in the existing untracked R4 modules; they are not a completed R4 implementation or a browser acceptance claim. `tools/e2e/cms-site-resources.mjs` also remains untracked. No feature integration, full test sweep, push, deploy or production-data mutation was performed for this access check.

Next: finish R4 integration and its recorded failing browser scenario, then targeted mutation/projection tests and the accumulated acceptance work listed above. Normal code editing is available for the continuation.
