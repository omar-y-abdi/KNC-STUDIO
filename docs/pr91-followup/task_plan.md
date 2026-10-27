# PR #91 — follow-up review and repair plan

## Boundary and acceptance

- Incoming review: user-provided adversarial report dated 27 October 2026, reviewing head `d800bad059271da7624bf0ae98e79ba2a1fb313f` against `f15b79b5131848d43e888e9841d14a7d71d50177`.
- These finding IDs belong to the incoming PR91 report, not the earlier PR90 ledger.
- Continue the authorized repair on `fix/pr90-reviewed-maintenance`; preserve original main/maintenance history and do not merge or perform production actions.
- Reproduce each reported code defect on the frozen head before accepting and repairing it. Add regressions at the real affected boundary; use existing project patterns and no new dependencies.
- Independently cross-review each repair, verify combined behavior, publish scoped commits with a current-head CI check before each batch, and finish only when the final exact-head CI is green.
- Keep O1 as a documented fixture-content limitation unless new evidence demonstrates a code regression. Do not rewrite owner content or screenshot baselines to conceal it.

## Finding ledger

| ID  | Reported boundary                                                                          | Assigned workstream | Acceptance criterion                                                                                                          | State                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Failed backup initialization retains a lock and hides the prior draft on SPA reopen        | Backup lifecycle    | Failed IndexedDB initialization followed by same-page retry preserves access to the original draft without stranding its lock | Reproduced, repaired, independently accepted and published in batch 1                                                               |
| F2  | Automatic migration blocks closed-tab draft adoption; reset/export guidance is ineffective | Recovery adoption   | Untouched migrated content can adopt a closed-tab draft; genuine edits and conflicts remain protected                         | Reproduced and repaired, including full reload, same-page reopen and legal-conflict preservation; final independent matrix accepted |
| F3  | Undo after publication reinterprets old layout provenance against a new base               | Layout provenance   | Failed capture → edit → publish → Undo → publish cannot submit mismatched resource data and HTML                              | Reproduced, repaired and independently accepted                                                                                     |
| F4  | Historical staff reconciliation retains obsolete staff HTML                                | Layout provenance   | Restored/current staff and published visible staff agree, including portrait-free changes                                     | Reproduced, repaired and independently accepted; retained-staff placement control passes                                            |
| F5  | Booking README omits accepted `rememberBookings`                                           | Coordinator         | Published API documentation matches the actual strict request parser and caller                                               | Real parser verified independently; documentation corrected and published in batch 1                                                |
| B1  | Immediate Studio exit loses a pending canvas update; also present on base                  | Backup lifecycle    | Trusted input followed by immediate exit/reopen preserves the final canvas edit                                               | Natural red in Chromium/WebKit, natural green plus deterministic regression; independently accepted and published in batch 1        |
| O1  | Same new fixture overflows English 800px viewport on both source versions                  | Coordinator         | Preserve the distinction between fixture content, code regression and production behavior                                     | Provenance clarified; no runtime, owner-content or screenshot-baseline change                                                       |

## Tasks

- [x] Read the complete supplied review and verify remote/local head and original base.
- [x] Establish the follow-up scope and isolate author worktrees.
- [x] Reproduce F1, F2, F3, F4 and B1; verify F5 with the real parser.
- [x] Implement minimal fixes with failing-then-passing regression evidence.
- [x] Independently challenge all fixes and test interaction boundaries between adoption, migration, provenance and exit.
- [x] Integrate, run combined relevant checks, and update review documents with exact receipts.
- [x] Inspect the previous head, publish the first verified batch, and verify its complete CI.
- [x] Prepare the independently accepted final batch and its exact remote acceptance gate below.

## Work documents

- [01-backup-lifecycle.md](01-backup-lifecycle.md): F1/B1 author plan, reproduction and verification.
- [02-restore-adoption.md](02-restore-adoption.md): F2 author plan, reproduction and verification.
- [03-layout-provenance.md](03-layout-provenance.md): F3/F4 author plan, reproduction and verification.
- [04-independent-review.md](04-independent-review.md): cross-review and adversarial closure.

## Initial evidence

- GitHub PR91 remains open/unmerged at `d800bad...`; frozen base is unchanged. Root worktree is clean at the same head.
- `submit-booking/README.md` claims only the example keys are accepted; `requestSchema` additionally accepts/defaults `rememberBookings`. No parser change is proposed.
- Existing green CI is a baseline, not proof against the newly reported behavior. The previous readiness claim is reopened for this follow-up.

## Coordinator verification log

- F5: executed the actual `requestSchema` with Node against the documented booking payload. Omitted/false/true `rememberBookings` all parse; omitted becomes false. An unknown root key rejects. The real booking adapter sends this field. README now includes it and explains its optional default; request and consent behavior are unchanged.
- PR91 was converted back to draft and its readiness paragraph replaced with a follow-up status. The previous successful exact-head receipt is explicitly identified as the `d800bad` checkpoint.
- F2 author reproduced the disabled adoption path on frozen `d800bad` using the actual revision-56 Studio fixture: legal pages migrate, no owner edit/publication occurs, and the expected enabled adoption control is disabled. Red receipt: `/tmp/knc-audit/pr91-adoption-red`.
- O1 provenance checked directly: the presentation fixture is absent from frozen main and present at `d800bad` as blob `8c8245ba2bbcd3d4a4401f447243bce2e997221e`. Prior base/head rendering used the same PR fixture. Added an explicit clarification to the original frontend review; no new production or historical-content claim, no visual-content change.

- F1 author reproduced real asynchronous IndexedDB transaction abort followed by same-page Studio exit/reopen: original record survives, but original draft is not recovered.
- F3/F4 author reproduced both real Studio sequences on unchanged d800bad: zero recapture attempts, successful publication with mismatched gallery/HTML (F3) or current staff data/former-staff HTML (F4), no page errors. Red evidence: `/tmp/knc-audit/pr91-layout-red/test-results/` and `/tmp/knc-audit/pr91-layout-red-unit.log`.

- B1 author reproduced natural trusted input then exit/unmount on unchanged head in both engines (Chromium 102.8 ms, WebKit 116 ms). Both lost the final text in IndexedDB. The shipped regression controls only debounce timing to avoid a wall-clock performance precondition; natural red/green receipts remain separate.
- Root raised a bounded F4 cross-check: SQL publishes historical `barbers.sort_order`, while the capture adapter currently retains live-roster order. Layout author is verifying whether same-member historical reordering needs the same provenance repair; no issue is asserted before reproduction.

- Coordinator source cross-review of F1/B1: failed initialization awaits release of only its acquired native lock before factory retry, including identity-write failure; successful sessions and other-tab locks retain their lifetime semantics. Exit schedules via current refs after synchronous editor flush, before unmount. No source blocker; final browser receipts and independent reviewer still required.
- F2 completion probe reproduced the migration-only autosave/reload variant against the initial repair. Author is fixing readiness of the independent unedited baseline as well as current document, with no persisted metadata or raw-base effect loop.

- F4 ordering challenge disposition: the actual reconciled-roster Studio → capture → public-render case passed the initial F3/F4 fix and preserved matching historical card placement. A helper-only ordering expectation was therefore not evidence of a public defect. No speculative sorting/projection change is accepted; layout author records the composition evidence and removes the unjustified helper expectation.

- F1/B1 author final focused lifecycle receipt: 20/20 cases (10 Chromium, 10 WebKit), with expected-versus-executed guard passing, no skips/retries/missing outcomes. Includes prior real-close, restore503/retry and source-race safeguards. Natural repaired exit probe and commit pending.
- Coordinator source review of F2 confirms publication base/dirty stay authoritative; adoption compares a separate automatically migrated unedited snapshot. The current draft and its baseline are migrated independently, reload readiness consults both, real edits/conflicts remain blocking, and the synchronous restore/source-effect guard is retained. New follow() migration callbacks will receive the contemporaneous base when integrated with F3.

- F1/B1 author commit `b0d41d7` integrated as `9cbf76a`: final lifecycle report has 20/20 cases, zero skipped/unexpected/flaky results and no report errors. The separate natural repaired exit probe passed in Chromium with a 44.4 ms input-to-exit interval. Fresh independent reviewer accepted the source and verified the native reports; this receipt review is separate from fresh integrated execution.
- F2 author commit `5d6b848` integrated as `fdf8ccd`: final report has 12/12 cases across Chromium/WebKit, no skips/retries/errors. The owner-input case now uses trusted Text inspector input before opening the backup panel. A prior behind-modal programmatic probe was rejected as unreachable and is not acceptance evidence. The completed-migration reload regression waits for actual source-frame completion and persisted state.
- F3/F4 author commit `5b2dd3e` integrated as `6d64a7c`: final report has 6/6 Chromium/WebKit cases, no skips/retries/missing outcomes. Integration commit `3c314c8` supplies `next.base` and `draft.base` to F2's two reset migration callbacks, preserving the new provenance contract.
- Combined product source `3c314c81ac4d460a9de45a6fa437328fd6751562`: full unit suite **155 files / 1,724 tests**, TypeScript, ESLint, full Prettier check, production build, bundle budget and local CMS backend release-stamp check pass. Public boot is **110.8 kB gzip against 115 kB**. No backend stamp change is required. Unit receipt: `/tmp/knc-audit/pr91-combined-unit.log`.
- First follow-up batch published as `258a988d5e47eed06e92ef22e25ab4de90eebf60` with a non-force leased update. Before the update, the exact previous head `d800bad` still had 26 successful checks and only the external Supabase Preview skip. Each API-created commit tree was checked against its local commit tree. Batch 1 includes the F5/O1 documentation and F1/B1 repair; CI run `40572183187` started for that head.
- Fresh independent combined browser discovery selected 14 Chromium cases: all ten new finding cases plus existing keep-local, conflict-reload, legal conflict Undo/Redo and legacy-zoom conflict Undo. Author two-engine receipts do not substitute for this combined execution or the final exact-head CI. The first attempt stopped at test-server startup before executing cases; its environment failure is being diagnosed and is not a product or green-test result.

- Fresh combined Chromium execution on `3c314c8` completed **13 passed / 1 failed**; its strict verifier correctly rejected the report. The failing existing legal conflict/Undo regression found leading HTML whitespace removed from all four legal variants. Trace comparison proves the F2 baseline-driven source effect newly reached an already-complete current document after a conflict reset its raw base to an empty document. The unconditional per-snapshot source migration caused the normalization; the existing exact-byte assertion is retained. Original F2 author owns the narrow per-snapshot source-need guard and its existing regression verification.
- Independent review additionally identified the same-page Studio exit/reopen variant of F2. Coordinator reproduced it on unchanged `3c314c8`: the complete migration-only backup was eligible before exit, actual exit unmounted Studio, the browser retained the same `performance.timeOrigin`, and adoption became disabled after remount. Correct red receipt: `/tmp/knc-audit/pr91-root-spa-red-standard/test-results/results.json`. An earlier external-directory probe failed module loading before any test and is diagnostic only.
- Coordinator's bounded cache fix retains the captured `CmsPage[]` as the existing promise value and reapplies it on each needing-source call. A later raw server-layout retention can no longer erase the reusable source value. In-flight sharing, failed-capture retry and complete-document fast path are unchanged. The unchanged actual-SPA probe passed **2/2 Chromium/WebKit** in 53.9 seconds (`/tmp/knc-audit/pr91-root-spa-green/test-results/results.json`). Both independent and backup peer reviewers accepted this source change. The permanent F2 regression now covers both full-page reload and same-page exit/reopen; final combined execution remains pending.

- Legal follow-up author commit `7ccf1a5` integrated as `29242fb`: the unchanged legal-conflict/Undo/Redo and source-zoom/Undo cases pass **4/4 Chromium/WebKit**, 85.9 seconds, one attempt each, no skips/flaky/errors. The source callback only calls `ensureCorePages` for snapshots whose own source is incomplete; it retains zoom normalization and provenance callbacks. No existing test assertion changed.
- Final integrated product source is `29242fb7aede7ccb975386fcfad9fa24a54e53c6`, tree `83f791a234db4dbbcf71172aafdd02d5f01d5791`. Full local verification repeated after both integration corrections: **155 files / 1,724 unit tests**, typecheck, full ESLint/Prettier, production build, **110.9 kB gzip / 115 kB budget**, and local CMS backend stamp all pass. Unit receipt: `/tmp/knc-audit/pr91-final-local-unit.log`.
- Backup author's independent peer review accepted the exact composed backup/draft/provenance/source files at `29242fb`, after separately checking the 2/2 SPA and 4/4 legal/zoom receipts. Its documentation-only appendix is integrated as `6167a60`; product and test code are unchanged. The fresh independent reviewer is executing the final 20-case two-engine matrix on `29242fb` and owns its final discovery/report guard.

- Final independent combined matrix on `29242fb` passed **20/20** in **426.3 seconds**: ten Chromium and ten WebKit cases. It covers all six F2 cases (including full reload and actual same-page exit/reopen), pending-source/adoption race, conflict-reload, exact legal conflict/Undo/Redo, and source-zoom conflict/Undo. The real discovered-versus-executed verifier passed with no skips, retries or missing outcomes. Machine JSON contains exactly twenty passed attempts, no unexpected/flaky cases and no runner errors. Source HEAD/tree remained unchanged throughout. Receipts: `/tmp/knc-audit/pr91-crossreview-final/test-results/results.json`, `/tmp/knc-audit/pr91-crossreview-final-expected.json` and `/tmp/knc-audit/pr91-crossreview-final-verifier.log`.
- First follow-up batch CI `40572183187` completed successfully for head `258a988d5e47eed06e92ef22e25ab4de90eebf60`. The separate CI reviewer verified source-artifact tree equality, completed job logs, full PostgreSQL/Edge/Storage/customer boundaries and zero failed steps in its interim receipt; the coordinator separately observed the final workflow success. This first-batch run is not substituted for the final combined head.

## Accepted review checkpoints and GitHub mapping

The connector creates commits with its own Git metadata. Each published tree is compared byte-for-byte with the local Git tree before the non-force leased ref update. These mappings make the local reproduction and review checkpoints addressable from GitHub after the final batch is published.

| Checkpoint                                                    | Local commit                               | Equivalent GitHub commit                   | Identical tree                             |
| ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| Backup/documentation batch                                    | `9cbf76ac36d0682f4fd8f6bf366476074d512ced` | `258a988d5e47eed06e92ef22e25ab4de90eebf60` | `0b99f4406f7de7651e9e90ea39c439455c48e964` |
| Initial combined source; integration failures reproduced here | `3c314c81ac4d460a9de45a6fa437328fd6751562` | `1eb7c66663045257ae6bf2ce9297a7d5661f0ac4` | `6dfecbc4eb21d4cf51dd215ad551d63604819f19` |
| Same-page cache repair                                        | `1af478f4d767165a34b3b3e0d295d53457bb2ab9` | `0b3130db5577a3166c7b69d55941facd831b9369` | `2135a470cbc382589b5e8c508d61ea46abbf87e6` |
| Final independently accepted product and test source          | `29242fb7aede7ccb975386fcfad9fa24a54e53c6` | `fda0b787da5651ca94f0ff3f4201350b90ea9c02` | `83f791a234db4dbbcf71172aafdd02d5f01d5791` |

## Final remote acceptance gate

Implementation, combined local verification and independent source/browser review are complete. F1–F5 and B1 have no open code blocker in this review. O1 remains the explicitly bounded fixture-content observation; no geometry or owner content was rewritten.

The coordinator must inspect the existing remote head's checks before the final batch update, verify every published tree, and wait for the complete CI and security checks on the exact final head. The durable completion receipt belongs in [PR91's body and checks](https://github.com/omar-y-abdi/KNC-STUDIO/pull/91), where it identifies the head, tested merge/tree, workflow run and actual counts without creating another source commit merely to name its own completed CI. A preceding green head does not satisfy this gate. Only after that gate is green may PR91 be marked ready for owner review. This work does not merge the PR or modify main/maintenance.

- Coordinator independently reran the final discovery/report verifier and parsed the native 20-case JSON before accepting the handoff. The independent review is integrated in `04-independent-review.md`; subsequent branch changes are documentation only. Final publication and remote CI remain subject to the gate above.
