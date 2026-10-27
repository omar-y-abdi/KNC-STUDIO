# PR #91 — follow-up review and repair plan

## Boundary and acceptance

- Incoming review: user-provided adversarial report dated 27 October 2026, reviewing head `d800bad059271da7624bf0ae98e79ba2a1fb313f` against `f15b79b5131848d43e888e9841d14a7d71d50177`.
- These finding IDs belong to the incoming PR91 report, not the earlier PR90 ledger.
- Continue the authorized repair on `fix/pr90-reviewed-maintenance`; preserve original main/maintenance history and do not merge or perform production actions.
- Reproduce each reported code defect on the frozen head before accepting and repairing it. Add regressions at the real affected boundary; use existing project patterns and no new dependencies.
- Independently cross-review each repair, verify combined behavior, publish scoped commits with a current-head CI check before each batch, and finish only when the final exact-head CI is green.
- Keep O1 as a documented fixture-content limitation unless new evidence demonstrates a code regression. Do not rewrite owner content or screenshot baselines to conceal it.

## Finding ledger

| ID  | Reported boundary                                                                          | Assigned workstream | Acceptance criterion                                                                                                                                     | State                                                                                                               |
| --- | ------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F1  | Failed backup initialization retains a lock and hides the prior draft on SPA reopen        | Backup lifecycle    | A failing IndexedDB initialization followed by retry in the same page preserves access to the original draft without stranding its lock                  | Verification pending                                                                                                |
| F2  | Automatic migration blocks closed-tab draft adoption; reset/export guidance is ineffective | Recovery adoption   | An untouched legacy server document can safely adopt a closed-tab draft; genuine user edits remain protected and UI guidance describes effective actions | Verification pending                                                                                                |
| F3  | Undo after publication reinterprets old layout provenance against a new base               | Layout provenance   | Failed resource capture → edit → publish → undo → publish cannot submit mismatched resource data and stored HTML                                         | Verification pending                                                                                                |
| F4  | Historical staff reconciliation keeps old staff HTML without invalidating it               | Layout provenance   | Restored/current staff membership and the published visible staff presentation agree, including portrait-free changes                                    | Verification pending                                                                                                |
| F5  | Booking README omits accepted `rememberBookings` while rejecting all unlisted keys         | Coordinator         | Published API documentation matches the actual strict request parser and its caller                                                                      | Confirmed with real parser; documentation corrected; independent review pending                                     |
| B1  | Immediate Studio exit loses a pending canvas update; present on base too                   | Backup lifecycle    | Trusted input followed by immediate exit/reopen preserves the final canvas edit                                                                          | Natural trusted-input regression reproduced in Chromium and WebKit; deterministic regression and repair in progress |
| O1  | Same new fixture overflows English 800px viewport with both source versions                | Coordinator         | Preserve accurate content/code/production boundaries in the final disposition                                                                            | Existing documented limitation; no runtime change proposed                                                          |

## Tasks

- [x] Read the complete supplied review and verify remote/local head and original base.
- [x] Establish the follow-up scope and isolate author worktrees.
- [x] Reproduce F1, F2, F3, F4 and B1; verify F5 with the real parser.
- [ ] Implement minimal fixes with failing-then-passing regression evidence.
- [ ] Independently challenge all fixes and test interaction boundaries between adoption, migration, provenance and exit.
- [ ] Integrate, run combined relevant checks, and update review documents with exact receipts.
- [ ] Check previous-head CI, publish scoped commits, and monitor final-head CI to completion.
- [ ] Record final exact-head receipt in PR91, mark ready for owner review and hand off without merging.

## Work documents

- `01-backup-lifecycle.md`: F1/B1 author plan, reproduction and verification.
- `02-restore-adoption.md`: F2 author plan, reproduction and verification.
- `03-layout-provenance.md`: F3/F4 author plan, reproduction and verification.
- `04-independent-review.md`: cross-review and adversarial closure.

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
