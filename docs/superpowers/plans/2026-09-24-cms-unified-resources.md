# CMS unified editing and resource assignments — implementation plan

> Fresh agent: read this file before changing code. Execute one task at a time using systematic-debugging, test-driven-development and verification-before-completion. Do not infer completion from a green unrelated test. Record exact implementation commits in the ledger below.

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
| ID | Deliverable | State | Implementation commit / verification |
|---|---|---|---|
| R1 | Indexed history reference lookup; no false upload failure | Investigated | Pending |
| E1 | Continuous editable Home/About with lossless save/reload | Investigated | Pending |
| E2 | Proportional nested resize and linked barber geometry | Pending | Pending |
| R2 | Real resource categories, upload destination dialog, draft assignments/reuse | Investigated | Pending |
| R3 | Contextual double-click picker for gallery/profile/logo/SVG; no stacked modal | Pending | Pending |
| R4 | Existing built-in resources and component controls visible in Resources | Pending | Pending |
| E3 | New authored page mobile header layout | Investigated | Pending |

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
