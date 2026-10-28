# Architecture, moves, documentation and visual coverage — PR #90 rescue

## Fixed review boundary

- Repository `/tmp/knc-pr90`; base `f15b79b5131848d43e888e9841d14a7d71d50177`; maintenance `aadb123dcd19d412a357a8e83ffc7603f3d55b0c`.
- The completed mapping phase was read-only. Implementation below uses `/tmp/knc-pr90-repair`; `/tmp/knc-pr90` remains frozen.
- Own all 41 architecture paths in `00-path-coverage.md` (7 modified, 2 added, 32 deleted); independent deletion/move checks; remaining 83 PNG pixel review transferred from reviewer 03. Pixel review now covers all 86 PNGs, including the three previously inspected.
- Other owners certify functional source and test semantics. Passing gates do not substitute for path review. Historical receipts are evidence of prior work, not fresh production verification.

## Review completion

- [x] **41/41 assigned documentation paths reviewed:** all nine current documents and all 32 deleted historical documents read in full. Both the old 1,135-line and new 135-line maps were read; changed hunks for modified documents were checked.
- [x] Active commands and literal path references checked; invalid customer command reproduced without starting a browser.
- [x] All **40 repository deletions and the one detected rename** classified: 32 documentation deletions, one scoped lockfile relocation, three removed unit files, four browser-suite consolidations, one product-module move.
- [x] All 34 assertion calls in the four removed browser specs accounted for; all old interaction/wait calls present in their successors.
- [x] **86/86 PNGs visually inspected**, 43 filename pairs; individual paths and dimensions in `evidence/png-review-ledger.json`.
- [x] Exact 41-path ledger below. No remaining unread owned path. Product source remains unchanged by this reviewer.

**Mapping completion is separate from repair acceptance.** DOC-01/02/03 and COV-01 are implemented below; independent cross-review and coordinator integration acceptance remain pending. Functional source outside this scope is owned by the other reviewers. Reviewer 04 has since reproduced the English 800px overflow on exact main with the same stored fixture; it is pre-existing owner-authored geometry.

## Confirmed findings and dispositions

### DOC-01 — Preserve operational recovery guards and selected historical receipts

**Accepted by coordinator; introduced by deletion of operational documents, with important safeguards already retained elsewhere.** `BACKEND.md` already preserves reviewed forward migrations before Edge/frontend, rejection of anonymous booking/customer RPC regrants, forward-compatible recovery after irreversible schema changes, durable Calendar handling, and hosted Edge/Vault checks. Do not report those broad safeguards as lost.

Repository-wide current Markdown inspection finds no replacement for the explicit preserve-unless-deliberately-migrated `PUBLIC_ACTION_HASH_SALT` warning (also the permanent-token encryption key; removed map line 771 explicitly documented this), nor the concrete rule to retain additive device receipt grants until their credentials expire and avoid destructive customer profile/mapping cleanup during incident rollback. The deleted customer repair/launch runbooks also explain compatible rollback of separate `Set-Cookie` forwarding, preserving session/signature checks, fail-closed repair, and provider-ledger-based recovery rather than blindly completing/resending jobs. Current `supabase/functions/send-confirmation/README.md` retains generation-CAS ciphertext repair and durable retry semantics; retain that authoritative implementation guidance rather than duplicate it.

**Minimal repair proposal:** add the missing recovery compatibility rules to the active backend operations guidance; preserve the four deleted operation documents below as clearly dated archival receipts with links to current guidance. These contain valuable actual migration/deployment baseline, rollout ordering, and recovery evidence. Never present their old `db push`, deploy, password rotation, migration or release verification commands as actions to repeat. No blanket restoration of all 32 deleted docs.

| Deleted receipt                                        | Preserved purpose / unique guidance                                                                                            | Active successor or gap                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `docs/operations/CUSTOMER_ACCESS_REPAIR_2026-09-10.md` | Recorded repair deployment, immutable encryption salt, signed gateway parity verification, fail-closed CAS/revocation recovery | Broad gateway contract in `BACKEND.md`; CAS retry in send-confirmation README; salt warning missing  |
| `docs/operations/CUSTOMER_DEVICE_ACCESS_2026-09-11.md` | Device bootstrap rollout compatibility, separate cookie headers, additive receipt retention during rollback                    | Runtime device/cookie contract documented; explicit recovery retention rule missing                  |
| `docs/operations/LAUNCH_RELEASE_2026-09-13.md`         | Exact baseline and backup/deployment receipt, safe identity-mapping recovery, authoritative provider ledger                    | Broad current contracts remain; historical recovery receipt otherwise disappears                     |
| `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md`    | Exact reviewed expand/contract migration baseline, history repair and ACL verification evidence                                | Core no-anonymous-regrant and forward-only rules retained in `BACKEND.md`; archive useful provenance |

### DOC-02 — New handoff incorrectly presents obsolete session constraints as current

**Introduced misleading guidance.** `docs/MAINTENANCE_HANDOFF.md` calls itself the current recovery entry point, then directs no local tests/builds/browsers/typechecks, Sol medium reviewers, work on the maintenance branch, no squash/rebase, and stop after baseline for the owner. These are historical session instructions and contradict the currently authorized clean replacement branch, six-reviewer map, and local verification. Preserve prior receipts and unresolved findings but give the handoff a prominent dated archive banner and point to current rescue plans. `docs/REPO_IMPROVEMENT_PLAN.md` is already identified as historical planning; its handoff link needs the same historical framing. Planned or rejected work in that large plan is not proof of implemented behavior.

### DOC-03 — Active CMS release verification instructions are stale

**Pre-existing issue in a modified file; not a new product regression.** `docs/operations/CMS_RELEASE.md` recommends `npm run test:e2e -- --customer`, which is incompatible with the actual Playwright CLI. Reproduced safely with `npm run test:e2e -- --customer --list`: exit 1, `error: unknown option '--customer'`; no browser launched. The same script existed on main. The guide also names removed bare `.mjs` suites instead of current `.spec.mjs` files and describes obsolete native-runner watchdog timings. Replace those instructions with the current commands/contracts in `docs/CI.md`, without turning historical incident notes into current status claims.

### COV-01 — Deleted source-string guards need selective semantic preservation

**Coverage regression, no demonstrated current product failure.** Deletion of `tests/unit/discovery.test.ts` and `tests/unit/sitemap.test.ts` removes meaningful checks not fully replaced by current tests: absence of an advertised-but-unsupported ACP manifest/claim; actual Google Calendar OAuth landing artifact with privacy/noindex semantics; `/terms` membership in the actual sitemap; and avoidance of invented last-modified metadata. The current Worker ACP test uses a deliberately 404-returning fake ASSETS binding, so it cannot detect a real added `public/.well-known/acp.json`. Current `agentReadiness.test.ts` sitemap assertions omit `/terms`. Coordinator accepted narrow guards against actual served artifacts / advertised routes, especially legal terms; do not restore duplicate string fragments or superficial fixed priority/frequency pins.

The removed `desktopTopPanel.test.ts` source CSS pin has stronger retained browser geometry assertions in `tools/e2e/public-checks.mjs` (initial and intermediate sticky-header top). No duplicate restoration proposed.

## Independent move and assertion accounting

The only product-file rename is `src/admin/views/homepageReplicaPorts.ts` → `src/cms/homepageReplicaPorts.ts` (Git R070). Compared pinned objects: seven relative import paths change; the functional body and native write-denial ports are unchanged. Current map uses the successor path.

All four removed E2E specs are retained as named tests. TypeScript AST token-normalized extraction compared every assertion and the old click, double-click, fill, select, reload, viewport, and explicit wait action. Two loopback safety assertions moved into helpers called by the respective tests; every product assertion and action is accounted for. Helpers and caller integration were read. This is static preservation evidence, not a claim that all possible runtime behavior is identical.

| Deleted spec                                  | Retained successor test               | Old assertion calls | New test-body calls | Accounting                                               |
| --------------------------------------------- | ------------------------------------- | ------------------: | ------------------: | -------------------------------------------------------- |
| `tools/e2e/cms-contextual-resources.spec.mjs` | `cms-draft-resources.spec.mjs:156`    |                  11 |                  10 | Remaining assertion in called `portraitResources` helper |
| `tools/e2e/cms-graphic-projection.spec.mjs`   | `cms-resource-projection.spec.mjs:57` |                   5 |                   5 | Exact normalized assertions/actions preserved            |
| `tools/e2e/cms-site-resources.spec.mjs`       | `cms-resource-workflow.spec.mjs:249`  |                  12 |                  11 | Remaining assertion in called `resourceHarness` helper   |
| `tools/e2e/cms-unified-home.spec.mjs`         | `cms-new-page-mobile.spec.mjs:99`     |                   6 |                   6 | Exact normalized assertions/actions preserved            |

Evidence: `/tmp/knc-audit/evidence/moved-spec-assertions.json`. All 34 original assertion calls accounted for; no missing old action calls. `deno.lock` deletion is the relocation to function-scoped lock/config reviewed by reviewer 03, not an erased dependency contract; this report does not independently certify dependency semantics.

## PNG review — complete, with explicit limits

All **86 changed PNGs**, 43 names in each of `tools/visual/baseline-linux` and `tools/visual/baseline`, decoded and were inspected as paired full-image contact sheets: `/tmp/knc-audit/evidence/contact-sheets/pairs-01.png` through `pairs-11.png`. Sheets display every image; full-page desktop images are reduced for overview, mobile images are effectively native-size. The three files previously viewed by reviewer 03 are included.

| Group                             | Distinct names |  Files | Inspected content                                                                                |
| --------------------------------- | -------------: | -----: | ------------------------------------------------------------------------------------------------ |
| Homepage 1280                     |              4 |      8 | Light/dark × Swedish/English, full-page hero, about, gallery, barbers, review form, footer       |
| Homepage 800                      |              4 |      8 | Same four variants; English stored-content horizontal overflow visible                           |
| Homepage 390 (full + five stages) |             24 |     48 | Four variants × six captures; collapsed/sticky header, consent, cards, reviews/footer            |
| About gallery/barber variants     |             11 |     22 | Desktop/mobile, light/dark/language and reduced-motion captures, intentionally clipped loop rows |
| **Total**                         |         **43** | **86** | **All inspected**                                                                                |

No empty/loading/error captures or unexpected broken-image glyphs observed. The 800px English captures are 825px (dark) and 846px (light) wide, with the review form exceeding the viewport. This is visible **pre-existing owner-authored overflow**, reproduced with identical dimensions on exact main by reviewer 04. Historical `REPO_IMPROVEMENT_PLAN.md` records the existing English 769–845px authored-content overflow and an owner-dependent content edit (PAR-16). The review form’s stored translation produces the same bounds on both trees. Do not hide it by changing baselines or clipping content.

Correctness limits: image URLs are deliberately replaced by local `public/og-image.png`; absent portrait placeholders are fixture choices. These captures do not certify actual production photographs, production content, live Worker responses, motion, all contrast, functional interactions, or universal layout correctness. Platform-specific text antialiasing/weight differences are visible and do not alone establish a defect. Contact-sheet review is a complete overview of changed image contents, not pixel-diff acceptance of every fine detail.

## Documentation map and reference check

The concise new map is an appropriate lower-maintenance replacement for the old duplicated inventories, RPC signatures, dependency versions, and historical deployment recipes. It links current backend authority, CMS feature/release contracts, CI, and backup guidance. The old map already contained drift: line 1008 called anonymous RPC regrant an emergency rollback option even though the referenced runbook prohibited it; old rows listed superseded CMS views, stale RPC definition versions, and incomplete outbox action inventories. Do not restore those claims. The old map's explicit salt/encryption recovery warning is included in DOC-01.

`evidence/active-doc-references.json` records a mechanical check of six active docs. All 28 mentioned npm script names exist. Manual interpretation matters: `src/cms/store.mjs` and `src/cms/client/editor.mjs` in the O-Y-A comparison are explicitly another repository's files, not missing KNC paths; `UX-CONTRACT.md` is contextual shorthand for the adjacent full CMS path. The actionable broken command and renamed suite references are DOC-03. This checker deliberately does not certify arbitrary shell arguments or historical commands as safe/current.

Most removed QA logs contain old task instructions, superseded failures, old CI counts, or explicitly corrected claims. Several contain test-recipient/contact details, further supporting selective preservation instead of reintroducing the whole archive. The four operational receipts selected for archival preservation contain no literal personal email addresses in their text. Their old command sequences must be prominently historical and cross-links to removed QA plans must point to current guidance or the pinned historical Git source.

### Critical removed guidance versus retained authority

| Concern                                                                           | Current retained authority / decision                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Server price, duration, availability, authorization                               | `BACKEND.md` booking flow; current map's server-authority boundaries; migration/integration owners certify implementation              |
| Anonymous booking/customer RPC denial; irreversible schema recovery               | Explicitly retained in `BACKEND.md:76–80`; archive old gateway receipt; never restore old map's contradictory regrant sentence         |
| Permanent-token encryption salt                                                   | Missing explicit caution in current docs; restore under DOC-01; historical map:771 and both customer operation runbooks corroborate    |
| Email identity, dual mailbox proof, whole-group locking, device exact-ID grants   | `BACKEND.md:24–40` retains active model; selected identity rollback/retention warnings restored under DOC-01                           |
| Ciphertext repair, concurrent generation, durable retry and recipient idempotency | Retained in `supabase/functions/send-confirmation/README.md`; link rather than duplicate its detailed repair procedure                 |
| Calendar durable trigger/outbox and retired legacy function                       | `BACKEND.md`, current map, current function docs and migration tests; historical launch receipt gives provenance, not live proof       |
| Backup/restore into new target, encrypted archive and external configuration      | `docs/operations/BACKUP_RESTORE.md` remains the authority; historical launch receipt remains useful evidence                           |
| Local test serialism, browser/DB isolation, CI architecture                       | Current `docs/CI.md` and real config; historical runner commands retired; DOC-03 fixes active CMS guide                                |
| Legal/static policy content                                                       | Reviewer 01 confirms content preservation; this review separately identifies missing `/terms`/discovery regression guards under COV-01 |

## Exact 41-path documentation ledger

Status **reviewed** means full document content and applicable delta read; it does not assert every historical claim was true in production. **Keep deletion** means no unique current safeguard requiring restoration was found after comparison with retained guidance. Historical Git evidence remains available. **Archive** means selected historical evidence should be restored with an explicit non-executable historical framing and a current-guidance link.

| Git | Path                                                              | Review disposition                    | Reason / successor                                                                                                                                                                           |
| --- | ----------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M   | `BACKEND.md`                                                      | Reviewed — DOC-01 addition            | Current authority retains deny/forward recovery and identity boundaries; add the missing salt and rollback compatibility rules.                                                              |
| M   | `CODEBASE-MAP.md`                                                 | Reviewed — keep concise successor     | Both complete versions read; remove duplicated stale inventories. Retain missing salt caution in BACKEND, not the old 1,135-line map.                                                        |
| M   | `README.md`                                                       | Reviewed — keep change                | Current local transport, CI command, source-tree and feature boundaries retained. No independent behavior loss from docs delta.                                                              |
| M   | `docs/CI.md`                                                      | Reviewed — reconcile with CI-01 owner | Current command/project descriptions inspected; workflow coverage correctness belongs to reviewer 03. Historical timings explicitly labeled.                                                 |
| M   | `docs/CMS_PARITY.md`                                              | Reviewed — keep path correction       | Only changed source pointer fixed. Existing broad shared-header language must not be read as newly implemented live propagation; independent saved page layout is documented in CMS_RELEASE. |
| D   | `docs/CMS_REDESIGN_PLAN.md`                                       | Reviewed — keep deletion              | Already superseded by CMS_PARITY, CMS UX/DESIGN and release guide.                                                                                                                           |
| A   | `docs/MAINTENANCE_HANDOFF.md`                                     | Reviewed — DOC-02 archive framing     | New active-entry claim exposes obsolete session instructions; preserve receipts, label historical, point to current rescue plans.                                                            |
| D   | `docs/PERFORMANCE_AUDIT.md`                                       | Reviewed — keep deletion              | Historical August measurements and prior implementation state; source/CI/performance contracts remain. No current performance guarantee inferred.                                            |
| A   | `docs/REPO_IMPROVEMENT_PLAN.md`                                   | Reviewed — keep historical evidence   | 579 lines fully read, including large decision tables. Retains owner decisions, deferred content changes and rejected proposals; clarify historical handoff link.                            |
| D   | `docs/handoffs/cms-five-issues.md`                                | Reviewed — keep deletion              | Completed PR75 checkpoint with old commands; active CMS feature/release/preview contracts remain.                                                                                            |
| D   | `docs/handoffs/cms-unified-resources-checkpoint.md`               | Reviewed — keep deletion              | Superseded PR78 work-in-progress instructions; committed behavior and acceptance scenarios remain in source/tests.                                                                           |
| M   | `docs/operations/CMS_RELEASE.md`                                  | Reviewed — DOC-03 command correction  | New cache restore/purge guidance reviewed; stale pre-existing customer CLI and suite/watchdog prose need precise correction.                                                                 |
| D   | `docs/operations/CUSTOMER_ACCESS_REPAIR_2026-09-10.md`            | Reviewed — archive under DOC-01       | Keep repair baseline and compatible recovery evidence; active salt/parity/fail-closed caution summarized in BACKEND.                                                                         |
| D   | `docs/operations/CUSTOMER_DEVICE_ACCESS_2026-09-11.md`            | Reviewed — archive under DOC-01       | Keep cookie/action rollout evidence and additive credential-grant retention rule; never replay old deploy sequence.                                                                          |
| D   | `docs/operations/LAUNCH_RELEASE_2026-09-13.md`                    | Reviewed — archive under DOC-01       | Keep exact verified backup/migration/provider receipt and data-preserving recovery constraints; no current deployment assertion.                                                             |
| D   | `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md`               | Reviewed — archive under DOC-01       | Already historical; preserves verified baseline and staged expand/contract recovery provenance. Core denial/forward rules already active in BACKEND.                                         |
| D   | `docs/qa/2026-08-27-production-real-life-test.md`                 | Reviewed — keep deletion              | Historical live snapshot with obsolete ACP and old blocked backup state; current safeguards/backup runbook supersede it.                                                                     |
| D   | `docs/qa/2026-09-10-audit/luna-hygiene.md`                        | Reviewed — keep deletion              | Historical hygiene findings with final PM disposition; avoids reviving optional process and owner-decision gates.                                                                            |
| D   | `docs/qa/2026-09-10-audit/luna-ui.md`                             | Reviewed — keep deletion              | Historical UI repairs and explicitly withdrawn autofill claims; durable interaction gates remain owned by frontend/CI reviewers.                                                             |
| D   | `docs/qa/2026-09-10-audit/pm.md`                                  | Reviewed — keep deletion              | PR58 chronology, corrected races/test evidence and superseded transport instructions; active backend/local setup remains.                                                                    |
| D   | `docs/qa/2026-09-10-audit/sol-admin.md`                           | Reviewed — keep deletion              | Historical target/draft/auth/media findings; no unique current operational recovery requirement found.                                                                                       |
| M   | `docs/qa/2026-09-10-audit/sol-platform.md`                        | Reviewed — keep historical correction | Changed text disambiguates historical evidence and removes stale external references; no active permission or runtime claim introduced.                                                      |
| D   | `docs/qa/2026-09-10-launch-completion/partner.md`                 | Reviewed — keep deletion              | Prior auth/device/privacy/Calendar design review and partially superseded identity proposal; current contracts and tests are authoritative.                                                  |
| D   | `docs/qa/2026-09-10-launch-completion/pm.md`                      | Reviewed — keep deletion              | Historical release/backup/test-recipient log; useful recovery specifics retained in selected operation archives and active guidance.                                                         |
| D   | `docs/qa/2026-09-10-launch-issues.md`                             | Reviewed — keep deletion              | Old unresolved issue/feedback form; later implementation and current authority supersede the status.                                                                                         |
| D   | `docs/qa/2026-09-11-launch-issues.md`                             | Reviewed — keep deletion              | Earlier release/user-decision summary; identity and privacy boundaries remain in active backend and CMS contracts.                                                                           |
| D   | `docs/qa/2026-09-13-launch/backend-high.md`                       | Reviewed — keep deletion              | Historical backend race, cookie, lifetime and test corrections; current tests and selected launch receipt retain actionable contracts.                                                       |
| D   | `docs/qa/2026-09-13-launch/cms-high.md`                           | Reviewed — keep deletion              | Optional legal identity defaults and no invented business facts retained in current CMS/Worker contract.                                                                                     |
| D   | `docs/qa/2026-09-13-launch/customer-identity-plan.md`             | Reviewed — keep deletion              | Completed identity design; dual proofs, exact source, generations/whole-group atomicity and private grants have active authority/tests.                                                      |
| D   | `docs/qa/2026-09-13-launch/gallery-high.md`                       | Reviewed — keep deletion              | Historical gallery empty/error/alt/decorative portrait acceptance; frontend owns current implementation.                                                                                     |
| D   | `docs/qa/2026-09-13-launch/issues.md`                             | Reviewed — keep deletion              | Superseded launch status summary; no unique active guard found.                                                                                                                              |
| D   | `docs/qa/2026-09-13-launch/luna-cms-visual.md`                    | Reviewed — keep deletion              | Historical live receipt with test-person/contact details; no fresh production proof or need to reintroduce personal details.                                                                 |
| D   | `docs/qa/2026-09-13-launch/luna-root-tests.md`                    | Reviewed — keep deletion              | Historical root/browser/HTTP execution log and corrections; retained tests carry current contract.                                                                                           |
| D   | `docs/qa/2026-09-13-launch/partner.md`                            | Reviewed — keep deletion              | Old hero/privacy/identity/Calendar implementation review; current functional owners certify those boundaries.                                                                                |
| D   | `docs/qa/2026-09-13-launch/pm.md`                                 | Reviewed — keep deletion              | Historical production/backup and late CI correction chronology; exact launch operational receipt preserved separately.                                                                       |
| D   | `docs/qa/2026-09-13-launch/ponytail-audit.md`                     | Reviewed — keep deletion              | Completed dead-code/complexity audit notes; no additional abstraction or rewrite justified.                                                                                                  |
| D   | `docs/superpowers/plans/2026-09-24-cms-unified-resources.md`      | Reviewed — keep deletion              | Full 246-line evolving PR78 plan read through final committed gate; obsolete incomplete checkpoints must not direct current work.                                                            |
| D   | `docs/superpowers/plans/2026-09-27-cms-latency.md`                | Reviewed — keep deletion              | Historical PR79 fixture-scoped latency experiment/implementation record; no proof of production timings implied.                                                                             |
| D   | `docs/superpowers/plans/2026-09-28-cms-context-latency.md`        | Reviewed — keep deletion              | Historical PR80 completion/repro notes; current browser contracts retained, old pending CI no longer authoritative.                                                                          |
| D   | `docs/superpowers/plans/cms-unified-resources-briefs/E2-brief.md` | Reviewed — keep deletion              | Completed task-local hierarchical resize brief; current feature contract and test remain.                                                                                                    |
| D   | `docs/superpowers/plans/cms-unified-resources-briefs/E3-brief.md` | Reviewed — keep deletion              | Completed task-local mobile header brief; current feature contract and test remain.                                                                                                          |

## Mapping limitations and implementation handoff

- No unread or unclassified assigned documentation or changed PNG path remains. All 40 deleted paths and the sole detected move have a disposition. The scoped Deno lock semantics remain reviewer 03's certification, not this review's.
- During mapping, no product edit, deployment, remote write, provider send, production access, or fresh functional-suite run was performed by reviewer 05. The only command-failure reproduction used Playwright's list path and stopped at CLI parsing. Parent owns fresh aggregate test results.
- Proposed implementation is deliberately bounded: active backend recovery paragraph plus selected historical operation archives; clear archived handoff; correct CMS test instructions; meaningful served-artifact/advertised-route regression assertions in the existing public representation suite. No new architecture framework, generic process document, or duplicate E2E restoration.
- Pixel coverage does not certify production content or every interaction; the English 800px overflow remains explicitly visible and is confirmed by reviewer 04 to match exact main. Do not equate green image comparison with a correct source baseline.
- Historical snapshots are under `evidence/base`, current snapshots under `head`, all from the pinned Git objects. Supporting machine-readable ledgers: `moved-spec-assertions.json`, `active-doc-references.json`, `png-review-ledger.json`, and `documentation-review-ledger.json`.

## Implementation — 27 October 2026

Authorized scope: DOC-01, DOC-02, DOC-03 and COV-01 only. Worktree: `/tmp/knc-pr90-repair`, branch `fix/pr90-reviewed-maintenance`. Coordinator owns integration, commits, remote publication and full verification. Other agents own CI, legal importing, editor recovery and backend migrations.

- [x] Restore the four operation runbooks byte-for-byte from frozen main, preceded by dated archive banners and links to active guidance.
- [x] Add only the missing concrete recovery rules to `BACKEND.md`, preserving its existing anonymous-RPC denial and forward-recovery guidance.
- [x] Label the obsolete maintenance handoff historical; correct the improvement plan's current-entry pointer.
- [x] Correct CMS release verification commands, current suite paths and obsolete watchdog claims.
- [x] Extend `agentReadiness.test.ts` using the existing actual Worker and checked-in asset harness: terms sitemap/route, truthful sitemap dates, absent unsupported ACP advertisement, and staff Calendar disclosure/privacy/noindex.
- [x] Run the focused public representation and documentation checks, check archive fidelity and changed-file formatting, and record exact outcomes.
- [ ] Independent cross-review and coordinator integration acceptance.

Frontend overflow attribution receipt: reviewer 04's isolated exact-main run at 800px produces the same widths as maintenance: 846px light and 825px dark. Source `#knc-about-0-i0-i11` has natural left 24px and outer width 558px; stored English translations of 264px/243px yield those right edges. Swedish translation 211px stays at 793px. Carousel clipping is not the cause. No visual asset or authored-layout change is part of this repair.

### Implementation receipts

- DOC-01: added the missing salt/encryption, mixed-version rollout, cookie/session/signature, receipt/profile retention and ledger-based recovery rules to `BACKEND.md`. Existing no-anonymous-RPC and forward-recovery rules are unchanged. Restored exactly four runbook bodies from frozen main; dated banners identify historical commands, explain historical links, and point to current backend, CMS, backup and rescue guidance.
- DOC-02: archived the maintenance handoff's authority and redirected the improvement plan to `docs/pr90-review/README.md`. Historical receipts and original owner decisions remain intact.
- DOC-03: replaced the unsupported customer flag with `npm run test:e2e:customer`, linked the local stack setup, replaced removed runner timing claims with the actual Playwright config/fixture authority, and corrected CMS suite paths to `.spec.mjs`.
- COV-01: the existing Worker/real-assets harness now checks `/terms` as a substantive served trust page and sitemap member; the served sitemap cannot invent last-modified dates; the actual ACP path must remain noindex/404; served and generated llms guidance cannot advertise unsupported ACP; and the served staff Calendar page retains a single primary heading, its synchronization/access disclosure, working privacy navigation and noindex. Customer-home navigation does not advertise the staff OAuth page. No new harness or dependency was added.

Focused verification on the repair worktree, 27 October 2026:

| Check                                                                                        | Result                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/unit/agentReadiness.test.ts tests/unit/documentationContracts.test.ts` | PASS — 22 tests, 2 files; actual Worker plus checked-in public assets, no network/provider calls                             |
| `npx eslint tests/unit/agentReadiness.test.ts`                                               | PASS                                                                                                                         |
| `npm run test:e2e:customer -- --list`                                                        | PASS — three native projects discovered: Chromium, Firefox, WebKit; no browser or database started                           |
| Scoped Prettier write/check                                                                  | PASS — active edits formatted; all four archived bodies already conform without modification                                 |
| Scoped `git diff --check`                                                                    | PASS                                                                                                                         |
| Archive fidelity                                                                             | PASS — each restored document ends with the exact original frozen-main bytes; all current-guide banner links resolve locally |

Archive body SHA-256 receipts:

| Original path under `docs/operations/` | Body SHA-256                                                       |
| -------------------------------------- | ------------------------------------------------------------------ |
| `CUSTOMER_ACCESS_REPAIR_2026-09-10.md` | `c125bd247648b8c140feb24d67567d79d6690a98e69b6e07e3db030b595dc912` |
| `CUSTOMER_DEVICE_ACCESS_2026-09-11.md` | `ed7984a9e53e661b96790b2aba80a8fbd15c9ddf3ff8184cff034ff6bca323f6` |
| `LAUNCH_RELEASE_2026-09-13.md`         | `863021420e899b384b76d632a165275a6c6803352ddd1cbe14db4e1e6f662fdd` |
| `PUBLIC_BOOKING_GATEWAY_ROLLOUT.md`    | `599efc22c7d45fd907b39eba037cd2e1022280f0b41eb173e03fcef4eff94098` |

No product runtime, CI configuration, migration, dependency, baseline image, or other review owner's file was edited. No staging, commit or remote action was performed. These focused checks do not replace the coordinator's integrated full gates. Independent cross-review remains pending.
