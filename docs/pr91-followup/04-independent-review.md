# PR91 follow-up — independent acceptance review

## Scope and status

This is a fresh independent review of the repairs prompted by the user-supplied adversarial report dated 27 October 2026. Its F1–F5, B1 and O1 identifiers refer to frozen PR91 head `d800bad059271da7624bf0ae98e79ba2a1fb313f`, not the earlier PR90 findings.

The reviewer owns only this document in `/tmp/knc-pr91-crosscheck`. Product changes are authored and integrated by the other workstreams. No remote mutation, deployment, merge, production publication or production data operation is performed by this reviewer.

**Status: accepted for coordinator handoff within the reviewed and tested boundaries.** The final combined run passed all 20 cases in Chromium and WebKit, and the strict discovery-to-outcome guard passed. No source or behavior blocker remains in this follow-up scope. The first combined run's 13 passes/one legal-content regression and the separately reproduced same-page recovery failure remain in the record below; neither was waived. Final exact-head CI and remote readiness belong to the coordinator and are not claimed by this local review.

## Review plan

- [x] Read the complete incoming report, preserving its attribution and execution boundaries.
- [x] Independently inspect the F1/B1/F5 product and test changes before first-batch acceptance.
- [x] Inspect F2 baseline, source migration, recovery, conflict and reset semantics.
- [x] Inspect F3/F4 provenance, historical staff projection and regression reachability.
- [x] Parse author red/green reports and distinguish execution failures, rejected hypotheses and accepted evidence.
- [x] Review the combined integration and verify every provenance callback has the contemporaneous base.
- [x] Execute the bounded Chromium matrix on the combined source and verify discovery against outcomes.
- [x] Review and execute the final affected cases after the two completion repairs are integrated.
- [x] Record final disposition, exact receipts and limitations; prepare this document only for handoff.

## Independent source assessment

### F1 — failed initialization retains its own lock

At first-batch commit `9cbf76a`, `TabLocks.claim` returns a release callback owned by the specific successful native request. `openBackupSession` covers the identity write, journal replay, legacy migration and initial own-record read in its failure handler. That handler awaits release completion before `cmsBackups` clears its rejected factory promise. A same-page retry therefore cannot race the native release or interpret that failed attempt as another tab. Successful sessions still hold their lifetime lock, and offers still exclude live tabs.

The unit regression uses shared records and lock state across failure and retry. The browser regression aborts a real IndexedDB read transaction after its request succeeds, then clicks Studio's actual exit control, unmounts and reopens on the same page. It checks the original draft, original tab identity and exactly one remaining claim. This is a regression of the reported condition, not merely a mock assertion about the release callback.

### B1 — immediate exit loses a pending canvas edit

The exit handler now calls `scheduleBackup()` after the synchronous editor flush and before `onExit()`. Scheduling reads the current draft/conflict refs, so it observes the document just exported by the editor. Existing unmount cleanup flushes that scheduled snapshot.

The committed regression uses real trusted inspector input and the actual exit button, with only debounce time controlled. It checks canvas content at the click, actual unmount, IndexedDB durability and same-page rehydration. The author's separate natural-clock red and green probes establish reachability inside the 180 ms window; the committed test avoids making browser action speed a CI precondition. This remains an existing base/head exit defect, not a newly attributed PR regression.

### F2 — automatic migration blocks recovery

`CmsDraft` keeps the raw publication base and a separately migrated unedited server snapshot. `dirty` still describes unpublished content. `hasEdits` describes content that adopting another draft would replace beyond those automatic migrations. `change`, `amend` and recovered/merged author documents do not replace this independent baseline. A replaced raw base falls back conservatively; successful publication acknowledges the new baseline while preserving later edits through the existing merge.

Studio constructs the baseline from the migrated server before applying own-backup or 409-merge content. Both the button and the flushed adoption handler reject author edits and unresolved conflicts. Reset migrates the raw base and retained snapshots through the existing migration API. The source effect also checks the unedited baseline: a fully upgraded autosave cannot bypass baseline preparation after reload. Existing synchronous restoration locking and source-response cancellation remain intact.

The new tests cover untouched revision-56 legal migration, pending source arrival with owner edits, export without discard, Undo/Redo, reset before source completion, trusted pending canvas input before opening the modal, complete migration-only autosave/reload, and reloaded genuine owner edits. Guidance accurately requires Export followed by Reset when keeping a copy; Export alone does not unlock recovery.

### F3/F4 — stale stored page presentation

`LayoutProvenance.sourceKey` records the initial inherited key on first observation. `follow(previous, next, base)` records the previous snapshot as well as its successor, so advancing the publication base cannot reinterpret an old Undo snapshot. Merges with matching current resource data now explicitly record their captured source; unknown/stale sides stay unknown until capture.

The resource key includes staff identity, name, Instagram, and both language variants of role and biography, matching the fields projected by `draftReadSnapshot`. Historical roster reconciliation therefore invalidates former-staff HTML even when photographs are unchanged. The regression uses real History and Publish controls, requires a recapture attempt, checks that blocked capture prevents publication, retries, and inspects the actual Worker's rendered page in a JavaScript-disabled browser.

The separate numeric staff-order concern was not accepted as another defect. The isolated adapter ordering expectation did not describe actual stored-template composition. The full Studio/history/capture/public-render control preserves retained authored placement and appends the current newcomer; no sorting or collation change was added to satisfy the rejected hypothesis.

### F5 and O1

The reviewer independently executed the actual `requestSchema` against the literal updated README JSON and four boundary cases. Omitted `rememberBookings` becomes `false`; explicit `false` and `true` parse; an unknown root key rejects. The README now documents the optional field/default and does not change request handling or consent behavior.

O1 remains a documented limitation of the new reference fixture's English 800 px layout. The report compares the same PR-added fixture under both frozen source versions. It does not establish that the fixture existed on the base, that rendering code caused a new overflow, or that production content was measured. No fixture geometry or screenshot baseline is changed by these repairs.

## Receipt inspection completed before fresh execution

- F1/B1: independently ran `verify-playwright-report.mjs` against `/tmp/knc-audit/pr91-backup-green-expected.json` and `/tmp/knc-audit/pr91-backup-green/test-results/results.json`: 20 discovered/executed cases, no skips, retries or missing outcomes. Inspected F1's correct recovered-name failures in Chromium/WebKit, B1's natural and controlled missing-backup failures, and the separate one-case natural Chromium green report. The initial WebKit natural probe exceeding the timing precondition is excluded from product evidence.
- F2: parsed the original disabled-adoption red report, the complete-autosave reload red report and final `/tmp/knc-audit/pr91-adoption-green-verified/test-results/results.json`: 12 passed, no skips, retries, unexpected outcomes, flaky cases or runner errors. Inspected the committed test source to verify source completion and trusted input precede the modal; superseded model mutation behind the modal is not accepted evidence.
- F3/F4: parsed `/tmp/knc-audit/pr91-layout-red/test-results/results.json`: the two correct-behavior assertions fail because stale publication occurs. Parsed the initial four-case Chromium/WebKit green report and the final `/tmp/knc-audit/pr91-layout-final-green/test-results/results.json`: six passed, no skips, retries, unexpected/flaky outcomes or runner errors.

These are independently checked author receipts. They are not represented as browser executions performed by this reviewer.

## Fresh combined verification

The isolated branch was fast-forwarded to combined product commit `3c314c81ac4d460a9de45a6fa437328fd6751562`, tree `6dfecbc4eb21d4cf51dd215ad551d63604819f19`. All four Studio provenance callbacks use the appropriate contemporaneous base, including `next.base` in conflict reset and `draft.base` in ordinary reset. No tracked product or test file changed during execution; this document is the only untracked repository addition.

The fresh Chromium selection contains 14 discovered cases: ten new finding regressions, `keep-local`, `conflict-reload`, legal conflict Undo/Redo and legacy-zoom conflict Undo. Discovery receipt: `/tmp/knc-audit/pr91-crossreview-combined-expected.json`.

The initial attempt ran zero tests: the sandbox refused Vite's loopback listener with `listen EPERM: operation not permitted 127.0.0.1:4688`. The generic wrapper log and direct stderr are preserved at `/tmp/knc-audit/pr91-crossreview-combined.log` and `/tmp/knc-audit/pr91-crossreview-startup-diagnostic.log`. The unchanged command was restarted with local networking permission; debug output confirms HTTP 200 from the harness before test execution. No repository configuration workaround was used.

Execution artifacts: `/tmp/knc-audit/pr91-crossreview-verified/`; log: `/tmp/knc-audit/pr91-crossreview-verified.log`. The run completed in 343.4 seconds with **13 passed, one failed, zero skipped, zero retries, zero flaky cases and no runner errors**. The report verifier rejects the actual failure, as required; its output is preserved at `/tmp/knc-audit/pr91-crossreview-report-rejection.log`. This is not an accepted green run.

All ten new finding regressions, both selected conflict cases and the legacy-zoom conflict case passed. The existing `legal upgrade survives conflict resolution, Undo and Redo` fails at its first resolved-draft equality assertion. Trace values prove that the raw initial publication has no pages, while the current draft has all six core pages. On a 409 conflict, `next.base` is replaced with the old raw publication; the new independent baseline therefore falls back to that empty base. Its source effect then unconditionally reserializes the already-complete current legal pages. Across all four legal variants, CSS stays equal and HTML differs exactly by removed leading whitespace. Decoded evidence: `/tmp/knc-audit/pr91-crossreview-legal-trace-comparison.json`.

The legal assertion remains unchanged. The F2 author repaired readiness per snapshot: prepare missing source only when that snapshot needs it, while retaining zoom normalization and provenance propagation. Independent source review found no blocker. The author's unchanged legal-conflict and source-zoom cases passed in both engines, four cases total, as independently parsed from `/tmp/knc-audit/pr91-adoption-legal-focused-green/test-results/results.json`. Fresh combined verification is below.

The reviewer also inspected the actual F4 public-page screenshot produced by this run: it visibly renders the current staff member. The same artifact's source receipt identifies the combined commit above, and its staff-order JSON agrees with the published staff data. This is a targeted inspection of the reproduced staff case, not a general visual audit.

## Supplemental interaction challenge

Source inspection identified a concrete same-page variant of F2. Refresh retains the raw server layouts in module-global `sourcePages`. A previously fulfilled `prepareCorePageSource` promise may then return without reinstating its captured templates. On an actual Studio exit/reopen, a complete recovered document and a still-legacy unedited baseline could differ solely because source preparation reused that global state.

The actual UI reproduction confirmed this failure on unchanged `3c314c8`. The reviewer prepared `/tmp/knc-audit/pr91-crossreview-probes/cms-spa.spec.mjs`, derived from the accepted complete-autosave test. Its only behavioral change replaces repeat navigation with closing the visible backup panel, clicking actual exit, asserting unmount, and rendering Studio again with a real unmounting callback. It asserts unchanged `performance.timeOrigin` and retains the existing completed-source and persisted-marker checks.

The coordinator executed the same helper through the standard repository configuration at offset 600. `/tmp/knc-audit/pr91-root-spa-red-standard/test-results/results.json` contains one failure at the second, post-remount enabled-adoption assertion; the initial eligibility, completed persisted source, actual unmount and stable page time origin passed first. The reviewer independently parsed this result. The earlier external-directory configuration attempt failed before testing on an import error and is excluded from product evidence.

The coordinator's cache repair stores the captured `CmsPage[]` as the promise value and reinstates it on every needed preparation, instead of only during the first capture. Source review finds no blocker: it preserves complete authoritative input, existing failed-capture retry semantics and capture reuse. The committed test retains the full-navigation variant and adds the actual same-page exit/reopen variant through one unchanged autosave workflow; all readiness, owner-edit protection, reset and no-implicit-publication assertions remain.

## Final combined verification

Final integrated product commit: `29242fb7aede7ccb975386fcfad9fa24a54e53c6`; tree: `83f791a234db4dbbcf71172aafdd02d5f01d5791`. The reviewer fast-forwarded the isolated branch and inspected the complete product delta from the first combined commit: only the captured-template cache and the per-snapshot source guard change product behavior.

The risk-based selection contains **20 discovered cases, ten in Chromium and ten in WebKit**:

- Six adoption cases per engine: untouched legacy input; owner edits across migration/export/Undo/reset; reset before source arrival; trusted pending canvas input; completed autosave after a full reload; completed autosave after actual same-page exit/reopen.
- Four existing interaction controls per engine: pending-source/adoption race; conflict reload with local resolution; legal conflict with exact content through Undo/Redo; legacy-zoom conflict Undo.

This final selection exercises both completion repairs together. F1/B1 and the three layout cases already passed in the first independent combined run; their repaired logic is unchanged by the completion repairs. Their author WebKit receipts are recorded above, and full integrated CI remains the coordinator's gate.

Command:

```sh
E2E_PORT_OFFSET=500 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-crossreview-final \
  node node_modules/@playwright/test/cli.js test \
  tools/e2e/cms-restore-adoption.spec.mjs tools/e2e/cms-lifecycle.spec.mjs \
  tools/e2e/cms-reported.spec.mjs tools/e2e/cms-marquee-zoom.spec.mjs \
  tools/e2e/cms-conflict.spec.mjs \
  --grep 'cms-restore-adoption|pending source upgrade cannot overwrite|legal upgrade survives conflict|undo after a conflict resolution|conflict-reload' \
  --project=cms-chromium --project=cms-webkit
```

The same selection with `--list --reporter=json` generated `/tmp/knc-audit/pr91-crossreview-final-expected.json`. Actual execution log: `/tmp/knc-audit/pr91-crossreview-final.log`; artifacts: `/tmp/knc-audit/pr91-crossreview-final/`.

Final result: **20 passed in 426.3 seconds**, with ten Chromium and ten WebKit cases, exactly 20 attempts, zero skipped/retried/flaky/unexpected cases, no runner errors and no failures. `verify-playwright-report.mjs` accepted the expected discovery and actual `/tmp/knc-audit/pr91-crossreview-final/test-results/results.json`: **20 browser cases; no skips, retries or missing outcomes**. The verifier log and independently parsed summary are `/tmp/knc-audit/pr91-crossreview-final-verifier.log` and `/tmp/knc-audit/pr91-crossreview-final-summary.json`.

The reviewer checked HEAD, tree and tracked diff after execution: the product identity above remained unchanged, with no tracked product/test changes. Only this review document was untracked. The document-only handoff does not claim another product execution or remote CI result.

## Final disposition

| Item | Independent disposition                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | Accepted: failure releases its acquired native lock before retry; original draft and identity survive actual IndexedDB abort and same-page reopen.                                                          |
| F2   | Accepted with both completion repairs: migrations remain unpublished but do not block recovery; real author edits/conflicts remain protected; full reload and actual same-page reopen pass in both engines. |
| F3   | Accepted: old Undo snapshots retain their layout source across publication, so failed recapture blocks stale publication and successful retry includes the resource in public HTML.                         |
| F4   | Accepted: portrait-free staff reconciliation invalidates historical HTML; actual stored public rendering agrees with current staff, including the retained-order control.                                   |
| F5   | Accepted: literal README payload and optional `rememberBookings` behavior agree with the actual strict parser.                                                                                              |
| B1   | Accepted as repair of the pre-existing exit defect: the latest trusted canvas edit is scheduled before unmount and survives reopen.                                                                         |
| O1   | Accurately retained as a fixture-content limitation, with no claim of a new runtime regression, production measurement or completed geometry correction.                                                    |

The independent review added two concrete completion checks to F2: source-cache reuse across actual Studio exit/reopen, and preservation of complete authored snapshots when only their unedited baseline requires migration. Both were reproduced before repair. Their real UI assertions are green on the final integrated product, and no assertion was relaxed to obtain acceptance.

## Limits

The focused browsers use actual Studio, GrapesJS, IndexedDB and Web Locks against isolated local test APIs. The public presentation assertions use the actual `renderCmsPage` function with scripting disabled. These checks do not run production authentication, the production router, SQL publication, real deployments or physical devices. The reviewer did not rerun the old base's browser suite or the full unit/static/build suite; author evidence and coordinator gates are identified separately. This is a bounded follow-up review, not another full-repository audit or a claim that all possible defects are excluded.
