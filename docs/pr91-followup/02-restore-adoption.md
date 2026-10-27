# F2 — Safe closed-tab adoption after automatic migration

## Scope and acceptance

Continue the authorized PR91 repair at frozen head `d800bad059271da7624bf0ae98e79ba2a1fb313f` in isolated branch `review/pr91-adoption`.

- An untouched revision-56 published presentation may be upgraded locally and remain unpublished, yet must allow adoption of a closed-tab draft.
- Actual author edits, including a pending editor capture, must block adoption until the owner publishes or resets them.
- Export saves a copy and does not discard current work; guidance must state the effective export-then-reset sequence.
- Preserve the restoration lock, failed-refresh retry screen, and guard against an older asynchronous source upgrade overwriting the adopted record.
- Do not change the authoritative publication base or mark migrated content published to make recovery possible.

## Plan

- [x] Read incoming F2 report, current repair plan, Studio/draft and existing lifecycle tests.
- [x] Add and run a real Studio regression on the frozen head; record the observed failure before implementation.
- [x] Implement the smallest migration-aware adoption guard and honest panel guidance.
- [x] Verify legacy recovery, author edits, pending canvas capture, reset, export, publication state, and the existing source race in Chromium and WebKit.
- [x] Run scoped unit/type/lint checks and receive independent source review.
- [x] Prepare the verified scoped result for local commit; combined review and final exact-head CI remain with the coordinator.

## Frozen-head diagnosis

- `refresh()` upgrades legal pages and marquee geometry, then sets `next.base` to the original server document when migration changed the document. The publication dirty state is therefore correct.
- Both `restoreOffer()` and the offer button currently use `dirty` to determine whether current work can be replaced. That wrongly treats generated migrations as author edits.
- `revertDraft()` returns to the raw base and applies the migration again. Export only downloads; it never changes the draft.
- Existing lifecycle adoption tests first publish the migrated presentation explicitly, so they exercise a clean receiving draft and miss this condition.
- Current restoration locking and source-upgrade race guard must stay unchanged.

## Receipts

### Red — frozen product head

- Command: `E2E_PORT_OFFSET=300 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-adoption-red npx playwright test tools/e2e/cms-restore-adoption.spec.mjs --project=cms-chromium`.
- Result: 1 failed at the correct behavior assertion `Fortsätt här` must be enabled for an untouched legacy receiver. Actual button remained disabled.
- Before failure: real Studio had migrated `/privacy` and `/terms`; its IndexedDB backup kept the raw server document as base; status was `Opublicerade ändringar`; zero publication requests occurred.
- Receipt: `/tmp/knc-audit/pr91-adoption-red/test-results/results.json`, plus the per-case attachment, screenshot and trace.

### Implementation

- `CmsDraft.hasEdits` compares against the independently migrated server snapshot; `dirty` still compares against the authoritative server publication. The comparison is cached by immutable snapshot identity.
- Only automatic migration transforms the editing baseline. Changes, amendments and recovered documents do not reset it. A changed public `base` falls back conservatively to that base; acknowledged publication resets the baseline to the newly published document.
- Studio builds this baseline from the migrated server before applying recovered or merged author edits. Reset migrates the raw publication and retained snapshots through the existing migration API.
- Both offer UI and its flushed handler require no author edits and no unresolved conflict. Existing synchronous restoration/source guards remain.
- Guidance now says to publish or reset; keeping a copy requires `Export` followed by `Återställ`.

### Rehydrated source-baseline regression

- A complete recovered document can skip the original source effect while its comparison baseline still reflects the older server. This was checked before adding source-readiness handling.
- The revision-56 reload probe passed after waiting for real source completion; it continued to request source and therefore did not isolate the skipped-effect branch.
- The isolating case uses an actual Studio-created/published native layout, removes only its booking-flow markers, waits for the automatic upgrade to persist, and asserts `needsCorePageSource(savedDocument) === false`. Its first untouched receiver is eligible; reloading that receiver made `Fortsätt här` disabled with the initial fix.
- Correct-behavior red receipt: `/tmp/knc-audit/pr91-adoption-red-reload-complete/test-results/results.json` and associated screenshot/trace. This is additional F2 lifecycle coverage, not a separate original report finding.
- The effect now considers `uneditedDocument` readiness as well as the recovered document. Migration still transforms each independently. The effect keeps its existing draft/source-attempt/restoring dependencies; it does not use the perpetually raw publication base as an effect trigger.

### Initial scoped author verification

- `npx vitest run tests/unit/cmsDraft.test.ts`: 9 tests passed, including migration versus author-edit state, late source migration, undo/redo/reset, changed base, publication acknowledgement and cached comparisons.
- Initial ten-case Chromium/WebKit run passed, but it is not the final acceptance receipt: a Home-only loading-label observation did not establish source completion, and the first pending-canvas control mutated a model behind the modal. Both observations were corrected before acceptance.
- Source controls now wait for the actual source iframe to detach and for a restored booking-flow marker in the persisted backup.
- The pending-canvas control uses actual inspector `Text` input before opening `Visa utkast`, with the capture timer paused. It proves the edit is absent from backup before the real panel-opening flush and present afterward; recovery remains disabled and the offered record remains.
- Final command: `E2E_PORT_OFFSET=300 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-adoption-green-verified npx playwright test tools/e2e/cms-restore-adoption.spec.mjs tools/e2e/cms-lifecycle.spec.mjs --grep 'cms-restore-adoption|pending source upgrade cannot overwrite' --project=cms-chromium --project=cms-webkit`.
- Final result: **12 passed, 0 failed, 0 skipped, 0 flaky** in 5.1 minutes. Receipt: `/tmp/knc-audit/pr91-adoption-green-verified/test-results/results.json`. Five new Studio cases and the existing pending-source/adoption regression each passed in Chromium and WebKit. The reload case also verifies that an actual edited backup stays protected after reopening.
- `npm run typecheck`, scoped ESLint for the two product files and two test files, and `git diff --check` passed on the final product code.
- Independent coordinator source review found no current blocker in the raw-base constructor, 409 baseline plus amendment, reset baseline/history migration, or source readiness. Publication dirtiness remains separate; recovered and merged author edits never become the unedited baseline; restoration cancellation and synchronous locking remain.

## Integration and limits

- Product scope: `src/admin/cms/draft.ts` and the migration/adoption sections of `src/admin/cms/Studio.tsx`. Tests: `tests/unit/cmsDraft.test.ts` and new `tools/e2e/cms-restore-adoption.spec.mjs`.
- No backup storage schema or `BackupSession` API changes. No dependency, owner fixture, screenshot-baseline, production, or remote changes.
- The coordinator must pass `next.base` and `draft.base` at the two new reset `layouts.current.follow` callbacks when combining the separately authored provenance signature change. The existing source migration callback is covered by that author's hunk.
- These tests use actual Studio, GrapesJS, browser storage and local routed test APIs; they do not exercise production SQL/auth/publication. The only publication in the reload test establishes its local native-layout fixture; no adoption path publishes.
- Fresh combined independent review and final exact-head CI are still required before overall acceptance.

## Combined-review follow-up — preserve complete snapshots

### Scope and plan

The fresh independent combined review at `3c314c81ac4d460a9de45a6fa437328fd6751562` found an exact-byte regression in the existing legal conflict/Undo/Redo browser test. Resume this narrow repair on `review/pr91-adoption-preserve-complete`, preserving the earlier author branch.

- [x] Read the independent failure and decoded trace; inspect source preparation, conflict and snapshot migration paths.
- [x] Reproduce the unchanged existing legal conflict assertion on the combined commit.
- [x] Correct only the Studio source-effect migration so complete snapshots retain authored bytes while incomplete snapshots and marquee zoom still migrate.
- [x] Run the unchanged failing legal-conflict case and source-zoom/Undo control in Chromium and WebKit, plus type/lint checks. The coordinator assigned the broader combined matrix to the independent reviewer.
- [x] Obtain independent source review and prepare the verified Studio/doc changes for local commit.

### Diagnosis

- Independent trace: initial raw publication base has zero pages; the current editable document has six. A 409 conflict retains the former raw base, so `uneditedDocument` falls back to it and triggers source preparation.
- The source callback currently calls `ensureCorePages` for every snapshot through `draft.migrate`, including already-complete current/history documents. `ensureCorePages` parses and serializes their legal HTML, removing leading whitespace before the main element.
- The failed comparison covers all four legal language variants; CSS remains equal and the HTML equals the original after removing only leading whitespace. No test assertion or fixture change is authorized.
- Ranked alternatives checked against the call sites: (1) unnecessary source reserialization of complete snapshots; (2) legal upgrading itself, whose wrapper replacement preserves captured whitespace; (3) a pending editor flush, although the active page is Home rather than either legal page. The per-snapshot source guard will be validated against the original exact-byte test.
- The coordinator separately owns the same-page source-cache repair in `corePages.ts`; this workstream will not modify that file.

### Follow-up receipts and decision

- Local red: `E2E_PORT_OFFSET=300 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-adoption-legal-red npx playwright test tools/e2e/cms-reported.spec.mjs --grep 'legal upgrade survives conflict resolution' --project=cms-chromium` on exact product `3c314c81ac4d460a9de45a6fa437328fd6751562`. The unchanged test failed at line 468, `the resolved draft`, with only leading HTML whitespace removed in all four legal variants.
- Repair: the source-effect `draft.migrate` callback now applies `ensureCorePages` only to snapshots for which `needsCorePageSource` is true. `normalizeMarqueeZoom` still runs for every snapshot. The existing migration/provenance callback and cancellation/restoration guards remain unchanged.
- Fresh independent source review found no blocker: readiness is evaluated separately for the editing baseline, current document and retained Undo/Redo snapshots. Complete authored snapshots avoid DOM reserialization; incomplete snapshots still upgrade.
- An initially scheduled twenty-case run was deliberately interrupted at the coordinator's request to avoid duplicating the independent combined matrix. It is not an acceptance receipt. The focused author matrix is the unchanged legal-conflict and source-zoom/Undo tests in both engines.

- Focused green command: `E2E_PORT_OFFSET=300 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-adoption-legal-focused-green npx playwright test tools/e2e/cms-reported.spec.mjs tools/e2e/cms-marquee-zoom.spec.mjs --grep 'legal upgrade survives conflict resolution|legacy zoom is converted once' --project=cms-chromium --project=cms-webkit`.
- Focused green result: **4 passed, 0 failed, 0 skipped, 0 flaky** in 1.4 minutes. Both engines pass the unchanged legal conflict/resolution/Undo/Redo exact-byte assertions and the existing source-upgrade zoom/Undo control. Receipt: `/tmp/knc-audit/pr91-adoption-legal-focused-green/test-results/results.json`.
- `npm run typecheck`, scoped Studio ESLint, Prettier and `git diff --check` passed. The only product diff is the guarded Studio callback; no test/assertion, fixture, cache, draft-model or dependency changes belong to this follow-up commit.
- This green result confirms unnecessary source preparation of complete snapshots caused the regression. No legal-content normalization or relaxed equality was introduced.
- Coordinator integration with the separately committed source-cache fix, the fresh independent combined matrix, and final exact-head CI remain outstanding outside this author branch.
