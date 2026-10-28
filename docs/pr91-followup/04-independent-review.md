# PR91 follow-up — independent acceptance review

## Scope and status

This is a fresh independent review of the repairs prompted by the user-supplied adversarial report dated 27 October 2026. Its F1–F5, B1 and O1 identifiers refer to frozen PR91 head `d800bad059271da7624bf0ae98e79ba2a1fb313f`, not the earlier PR90 findings.

The reviewer owns only this document in `/tmp/knc-pr91-crosscheck`. Product changes are authored and integrated by the other workstreams. No remote mutation, deployment, PR merge, production publication or production data operation is performed by this reviewer.

**Status: accepted for coordinator handoff on product `d65f1d27ddd3b5f9e8c0903d1c20beb44badd458`, within the reviewed and tested boundaries.** The latest independent run passed all 16 selected cases in Chromium and WebKit, with the strict discovery-to-outcome guard also passing. Ordinary Reset now restores a clone of the independently prepared server baseline without rechecking all retained history. Both engines record one reset HTML parse under the unchanged limit of fewer than 24. No blocker remains in the bounded checks below.

The earlier 20-case local acceptance at `29242fb` is a historical checkpoint: subsequent full CI on published `9ba00fd` exposed the reset-cost regression and a separate WebKit navigation abort. Those failures, the first combined run's 13 passes/one legal-content regression, and the separately reproduced same-page recovery failure remain in this record. None was waived or hidden by the latest result. Final exact-head CI and remote readiness belong to the coordinator and are not claimed by this local review.

## Review plan

- [x] Read the complete incoming report, preserving its attribution and execution boundaries.
- [x] Independently inspect the F1/B1/F5 product and test changes before first-batch acceptance.
- [x] Inspect F2 baseline, source migration, recovery, conflict and reset semantics.
- [x] Inspect F3/F4 provenance, historical staff projection and regression reachability.
- [x] Parse author red/green reports and distinguish execution failures, rejected hypotheses and accepted evidence.
- [x] Review the combined integration and verify every provenance callback has the contemporaneous base.
- [x] Execute the bounded Chromium matrix on the combined source and verify discovery against outcomes.
- [x] Review and execute the final affected cases after the two completion repairs are integrated.
- [x] Reopen acceptance after full CI, independently trace reset work, review the minimal repair and execute the 16-case two-engine matrix without changing the cost gate.
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

Studio constructs the baseline from the migrated server before applying own-backup or 409-merge content. Both the button and the flushed adoption handler reject author edits and unresolved conflicts. Ordinary Reset clones the prepared unedited snapshot, keeps the raw publication base and preserves the authored current snapshot for Undo. It does not run another migration across retained history. Actual source arrival still migrates the baseline, current document and retained snapshots through the existing migration API; conflict Reset still prepares its fresh draft. The source effect also checks the unedited baseline: a fully upgraded autosave cannot bypass baseline preparation after reload. Existing synchronous restoration locking and source-response cancellation remain intact.

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

## Initial combined verification — rejected checkpoint

The isolated branch was fast-forwarded to combined product commit `3c314c81ac4d460a9de45a6fa437328fd6751562`, tree `6dfecbc4eb21d4cf51dd215ad551d63604819f19`. At that historical source, all four Studio provenance callbacks used the appropriate contemporaneous base, including `next.base` in conflict reset and `draft.base` in ordinary reset. No tracked product or test file changed during execution; this document was the only untracked repository addition.

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

## Earlier combined verification — 29242fb

Earlier integrated product commit: `29242fb7aede7ccb975386fcfad9fa24a54e53c6`; tree: `83f791a234db4dbbcf71172aafdd02d5f01d5791`. The reviewer fast-forwarded the isolated branch and inspected the complete product delta from the first combined commit: only the captured-template cache and the per-snapshot source guard changed product behavior at this checkpoint.

The risk-based selection contains **20 discovered cases, ten in Chromium and ten in WebKit**:

- Six adoption cases per engine: untouched legacy input; owner edits across migration/export/Undo/reset; reset before source arrival; trusted pending canvas input; completed autosave after a full reload; completed autosave after actual same-page exit/reopen.
- Four existing interaction controls per engine: pending-source/adoption race; conflict reload with local resolution; legal conflict with exact content through Undo/Redo; legacy-zoom conflict Undo.

This selection exercised both completion repairs together. F1/B1 and the three layout cases already passed in the first independent combined run; their repaired logic was unchanged by those completion repairs. Their author WebKit receipts are recorded above. This local acceptance did not replace the subsequent full integrated CI gate.

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

Result at that checkpoint: **20 passed in 426.3 seconds**, with ten Chromium and ten WebKit cases, exactly 20 attempts, zero skipped/retried/flaky/unexpected cases, no runner errors and no failures. `verify-playwright-report.mjs` accepted the expected discovery and actual `/tmp/knc-audit/pr91-crossreview-final/test-results/results.json`: **20 browser cases; no skips, retries or missing outcomes**. The verifier log and independently parsed summary are `/tmp/knc-audit/pr91-crossreview-final-verifier.log` and `/tmp/knc-audit/pr91-crossreview-final-summary.json`.

The reviewer checked HEAD, tree and tracked diff after execution: the product identity above remained unchanged, with no tracked product/test changes. Only this review document was untracked. The document-only handoff does not claim another product execution or remote CI result.

## Full-CI rejection and reset-cost repair

Full CI `40576738699` on published head `9ba00fdd990209d110104a93c7e0680e1f1c9aa9` was not accepted. The coordinator's complete browser accounting recorded 597 of 600 cases passing. Both CMS shard-1 engines failed the unchanged `cms-context-latency.spec.mjs` assertion that complete Reset must use fewer than 24 HTML parses. The reviewer independently read `/tmp/knc-audit/pr91-final-ci/cms-chromium-1/context-cost.json`: Reset used **41 parses**, zero component creations, one export and zero CSS parses; history restore used ten parses. The 287 ms reset duration is diagnostic context, not the failed threshold.

The third CI failure was separate. The coordinator's trace review identified a WebKit navigation abort before the recipient Studio mounted in the owner-edit/adoption case, with no response and a `_WKPage._onLoadingFailed` stack. No product cause was established. The reset repair is not claimed to fix that navigation cause, and no navigation workaround, retry or assertion change was introduced. The same owner case is included in the fresh run below and must also execute in the coordinator's next complete CI gate.

Independent source tracing found that ordinary Reset cloned the raw publication and then called `draft.migrate` over the independent baseline, every retained Undo/Redo snapshot and the current document. For a complete snapshot, `needsCorePageSource` parses the eight nonlegal language variants. This repeated readiness work grew with history even though no new source migration had arrived. The author reproduced the unchanged Chromium failure at the exact published head: `/tmp/knc-audit/pr91-adoption-reset-red/test-results/results.json`, with 41 reset parses. The author also recorded two failing strengthened draft tests before the product change.

The accepted repair is limited to ordinary Reset. `CmsDraft.revert()` now clones `uneditedDocument` and leaves that independent prepared baseline and the raw publication base intact. It retains the previous authored document for Undo and clears pending save state and Redo as before. The clone prevents later current-document changes from redefining the baseline. Studio removes the now-redundant ordinary-reset `migrate` call. The existing dirty guard, conflict Reset, source-arrival migration, source cache and provenance implementation remain unchanged.

The reset clone can inherit the current raw base's resource key: the automatic migrations change presentation, while the prepared baseline's resource data still belongs to that publication. Undo retains the actual authored snapshot and its existing provenance. Existing draft tests now require migrated reset content without manually repeating migration, plus unchanged raw base, migration dirtiness, pending-save invalidation and correct owner-edit protection through Undo/Redo. The existing browser owner case adds Reset → Undo → Redo checks: Undo restores the owner edit and blocks adoption; Redo restores eligibility without publishing.

The reviewer independently parsed the author's ten-case Chromium/WebKit result and reran the discovery verifier: `/tmp/knc-audit/pr91-adoption-reset-green/test-results/results.json`, `/tmp/knc-audit/pr91-adoption-reset-expected.json` and `/tmp/knc-audit/pr91-adoption-reset-verifier.log`. All ten passed in 265.4 seconds, one passing attempt each, with no skips, retries, flaky/unexpected outcomes or runner errors. This is inspected author evidence, separate from the fresh independent execution below.

## Fresh reset-repair verification — d65f1d2

The previous review branch was preserved. The reviewer created `review/pr91-reset-crosscheck` from failed published head `9ba00fd`, then fast-forwarded to integrated product **`d65f1d27ddd3b5f9e8c0903d1c20beb44badd458`**, tree **`efb5994a6152c3ac21a036310c77f6f986bf550b`**. Source review confirmed the two narrow reset changes and strengthened existing tests described above. No cost assertion, threshold, retry setting, fixture or product configuration changed.

The selection contains **16 discovered cases, eight per engine**: the unchanged context-cost test; pending-source/adoption race; published Reset followed by reload; exact legal conflict/Undo/Redo; owner edits across migration/export/Reset/Undo/Redo; Reset before source completion; completed migration-only autosave after full reload; and completed autosave after actual exit/unmount/reopen in the same page. These cover the concrete reset, baseline, history, source-cache and legal-preservation risks. Unaffected layout cases were not duplicated.

```sh
E2E_PORT_OFFSET=500 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-crossreview-reset-final \
  node node_modules/@playwright/test/cli.js test \
  tools/e2e/cms-context-latency.spec.mjs tools/e2e/cms-restore-adoption.spec.mjs \
  tools/e2e/cms-lifecycle.spec.mjs tools/e2e/cms-reported.spec.mjs \
  tools/e2e/cms-owner.spec.mjs \
  --grep 'cms-context-latency|preserves owner edits across source migration|reset remains eligible|a migration-only autosave|pending source upgrade cannot overwrite|legal upgrade survives conflict|revert-reload' \
  --project=cms-chromium --project=cms-webkit
```

The same command with `--list --reporter=json` generated `/tmp/knc-audit/pr91-crossreview-reset-final-expected.json`. Local loopback permission was supplied without altering repository configuration. Actual log: `/tmp/knc-audit/pr91-crossreview-reset-final.log`; native report: `/tmp/knc-audit/pr91-crossreview-reset-final/test-results/results.json`.

**Fresh result: 16 passed in 383.7 seconds.** All eight cases passed in each engine, with exactly 16 attempts and zero skipped, retried, flaky, unexpected or failed outcomes and no runner errors. Every discovered case expected a pass and passed on its only attempt. `verify-playwright-report.mjs` accepted the discovery and actual reports: **16 browser cases; no skips, retries or missing outcomes**. Verifier output: `/tmp/knc-audit/pr91-crossreview-reset-final-verifier.log`; independently parsed outcomes and cost rows: `/tmp/knc-audit/pr91-crossreview-reset-final-summary.json`.

| Engine   | Reset HTML parses | Component creations | Exports | CSS parses | History-restore HTML parses |
| -------- | ----------------- | ------------------- | ------- | ---------- | --------------------------- |
| Chromium | 1                 | 0                   | 1       | 0          | 10                          |
| WebKit   | 1                 | 0                   | 1       | 0          | 10                          |

These are the actual `revert` and `history:restore` rows in each case's `evidence/context-cost.json`. The existing Reset requirement remains `< 24`; no limit or assertion was relaxed. The result establishes bounded operation counts in these workflows, not a cross-environment wall-clock improvement. The strengthened owner case passed in both engines without the earlier WebKit navigation abort; that successful execution does not establish the cause of the prior abort.

Post-run HEAD, tree and tracked diff checks confirmed the exact product above remained unchanged and the worktree was clean. Only after verification did the reviewer update this owned document. The new exact-head remote CI result remains the coordinator's gate and is not supplied by this document-only handoff.

## Final disposition

| Item | Independent disposition                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | Accepted: failure releases its acquired native lock before retry; original draft and identity survive actual IndexedDB abort and same-page reopen.                                                                                                                         |
| F2   | Accepted with the source completion and reset-cost repairs: migrations remain unpublished without blocking recovery; owner edits/conflicts stay protected; prepared-baseline Reset, Undo/Redo and both reopening paths pass in both engines under the unchanged cost gate. |
| F3   | Accepted: old Undo snapshots retain their layout source across publication, so failed recapture blocks stale publication and successful retry includes the resource in public HTML.                                                                                        |
| F4   | Accepted: portrait-free staff reconciliation invalidates historical HTML; actual stored public rendering agrees with current staff, including the retained-order control.                                                                                                  |
| F5   | Accepted: literal README payload and optional `rememberBookings` behavior agree with the actual strict parser.                                                                                                                                                             |
| B1   | Accepted as repair of the pre-existing exit defect: the latest trusted canvas edit is scheduled before unmount and survives reopen.                                                                                                                                        |
| O1   | Accurately retained as a fixture-content limitation, with no claim of a new runtime regression, production measurement or completed geometry correction.                                                                                                                   |

The independent review added two concrete completion checks to F2: source-cache reuse across actual Studio exit/reopen, and preservation of complete authored snapshots when only their unedited baseline requires migration. Both were reproduced before repair. Full CI subsequently exposed repeated readiness work during ordinary Reset. The prepared-baseline correction addresses that operation-count failure while retaining owner-edit protection and Undo/Redo. The latest combined real UI checks pass on the identified product; no assertion was relaxed to obtain acceptance.

## Limits

The focused browsers use actual Studio, GrapesJS, IndexedDB and Web Locks against isolated local test APIs. The public presentation assertions use the actual `renderCmsPage` function with scripting disabled. These checks do not run production authentication, the production router, SQL publication, real deployments or physical devices. The reviewer did not rerun the old base's browser suite or the full unit/static/build suite; author evidence and coordinator gates are identified separately. This is a bounded follow-up review, not another full-repository audit or a claim that all possible defects are excluded.
