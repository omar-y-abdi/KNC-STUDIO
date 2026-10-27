# PR #90 replacement — execution plan

## Contract

- Repository: omar-y-abdi/KNC-STUDIO. Original PR #90 remains the historical reference.
- Frozen main: f15b79b5131848d43e888e9841d14a7d71d50177.
- Frozen maintenance: aadb123dcd19d412a357a8e83ffc7603f3d55b0c.
- Review all 447 changed paths and material surrounding contracts before implementation.
- Preserve valid original behavior, legal information and safeguards; verify suspected regressions before changing them.
- Create a separate branch from main with maintenance's tree as its initial content, excluding maintenance's 238-commit ancestry. Keep main and maintenance unchanged.
- Publish a new PR, push verified groups of changes, inspect current-head CI before each push, repair failures, and finish only with current-head CI green and independent reviews resolved.
- No production deploy, production SQL, publication, merge, deletion of historical branches, or unrelated external messages.

## Workstreams

Each agent owns one living Markdown document with findings, evidence, decisions, tasks, checks and review disposition. Three subagents can run simultaneously; six Max-reasoning reviewers run in two waves. Four implementation agents work in waves plus the coordinator.

| Owner                | Scope                                                             | Document                    |
| -------------------- | ----------------------------------------------------------------- | --------------------------- |
| Coordinator          | refs, coverage, integration, Worker, final CI and review          | task_plan.md                |
| Legal/privacy        | legal text, consent, retention and public claims                  | 01-legal-privacy.md         |
| Backend/security     | auth, SQL, Edge functions, permissions, data integrity            | 02-backend-security.md      |
| Verification         | CI, test integrity, dependencies, release configuration           | 03-verification-ci.md       |
| Frontend             | public UI, CMS/admin behavior, accessibility, browser integration | 04-frontend-runtime.md      |
| Architecture         | moves/deletions, documentation and complexity                     | 05-architecture-coverage.md |
| Adversarial reviewer | contradict findings, cross-boundary failures, review closure      | 06-independent-review.md    |

## Acceptance gates

- Every changed path assigned and reviewed; moves distinguished from behavioral changes.
- Each accepted issue has source evidence and, where executable, a reproduction/regression check.
- No invented legal conclusions: restore proven regressions and verify relevant legal requirements against primary official sources.
- Changes remain traceable to accepted findings and preserve features unless removal is justified and documented.
- Full relevant lint, formatting, typecheck, tests, build, browser and database checks run locally or in CI; exclusions disclosed.
- Clean commit history relative to main, reviewable commits, matching local/remote content and complete review documents.
- Latest PR head's required checks pass, no unresolved reviewer finding, no merge.

## Tasks

- [x] Resolve PR, freeze source refs, read discussion and establish isolated checkout.
- [x] Map all changed paths, baseline behavior and test surface; complete six review workstreams.
- [x] Reconcile findings into a deduplicated implementation ledger and decide minimal repairs.
- [x] Create replacement branch with maintenance tree and main-only ancestry; commit review map.
- [ ] Implement verified legal/privacy, backend/security, frontend/runtime and CI/infrastructure repairs.
- [ ] Independently cross-review each implementation, execute regression evidence and integrate.
- [ ] Open replacement PR and publish verified batches while monitoring CI.
- [ ] Resolve current-head CI and complete final whole-diff adversarial review.
- [ ] Deliver PR and concise evidence-based report.

## Evidence and operational notes

- GitHub API: PR #90 open, base main, head maintenance; 238 commits, 447 files, +27,766/-11,028.
- Initial sandbox clone failed on its network proxy. Approved network escalation succeeded; normal local Git is available.
- PR body states no local tests/build/typechecks/database/browser runs were executed by its author; CI pass claims will be independently verified.
- PR includes a Cloudflare bot deployment message for historical commit 114e92c7; do not infer current production state from it.

## Verification log

Record exact commands, exit codes, ref/SHA and significant outcomes here or in each owner document. An agent's assertion is not acceptance evidence.

### Frozen maintenance baseline

- `npm ci --no-audit --no-fund`: PASS, 348 packages; isolated checkout, Node 24.22.1.
- `npm test` (default sandbox): 27 failures in 3 files caused by blocked subprocess/loopback operations (EPERM); not classified as repository defects.
- `npm test` with approved execution permissions: PASS, 155 files / 1,715 tests; `/tmp/knc-audit/baseline-unit-network.log`.
- `npm run typecheck`: PASS.
- `VITE_SUPABASE_URL=https://admin-harness.invalid VITE_SUPABASE_ANON_KEY=e2e-public-anon-key VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build`: PASS. Uses fake harness values, no production data.
- GitHub frozen head: 25 successful checks and external Supabase Preview skipped, including CI 40231920510 and CodeQL 40231920672. PR-only CMS WebKit subset still under review.
- Playwright Chromium install failed because CDN archive was empty/truncated. Separate WebKit/Firefox install being attempted; no product change justified by this environment failure.
- 447-path ownership map created in `00-path-coverage.md`; ownership alone is not completed review.
- `npm run lint`: PASS. `npm run bundle-budget`: PASS, 110.7 kB gzip in 13 initial files, budget 115 kB.
- Chromium CDN diagnostic: official Playwright CDN returns 195-byte text/html for the ZIP path. Google's official Chrome-for-Testing URL serves the correct 119,778,157-byte same-version archive; ZIP integrity passed. WebKit/Firefox fallback mirror downloads succeeded. Local OS browser dependencies installed in the isolated environment.

### Coordinator source review

- Reviewed all eight assigned source/config diffs: `index.html`, `public/_headers`, `shared/site-page.ts`, `src/cmsRuntime.tsx`, `src/site/cmsThemeScript.ts`, `src/site/routeMetadata.ts`, `src/worker.ts`, `wrangler.jsonc`, plus their direct tests and public adapter/presentation consumers.
- Rejected hypothesis: runtime-island quote spellings could cause app removal. The publication boundary parses and serializes markup (`validateDocumentMarkupPlacements`), normalizing accepted attributes to the renderer's expected form. A raw render helper test alone would not establish production reachability.
- Versioned response caching uses a complete upstream body and matching nonnegative revision with no-store fallback; existing tests cover timeout, mismatched revision and immutable-cache headers. No confirmed cache/auth regression from source review.
- Legal text removal suspicion not supported by static-file diff: changes are CSS/layout and legacy CSS snapshots, not deletion of the static privacy/terms/calendar copy. Actual CMS importer and serving paths remain under investigation.
- Confirmed CI-review candidate: PR-only WebKit selection executes 25 of 125 currently discovered CMS tests; 100 are omitted before merge. Implementation and independent review pending.

## Accepted findings / implementation ledger

| ID     | Severity    | Evidence and decision                                                                                                                                                                                                                                                          | Owner                                         | State                                                                                                                                    |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CI-01  | P2          | PR-only CMS WebKit grep excludes 100/125 cases; restore full pre-merge engine matrix and its guard tests.                                                                                                                                                                      | Verification                                  | Mapped, implementation pending                                                                                                           |
| L1     | P2          | Legal source fetch follows `.html` redirect into CMS-rendered built shell; importer rejects its `/assets/*.css` link. Use explicit shipped source templates without copying generated shell or replacing authored draft content.                                               | Legal + frontend                              | Independently reproduced by coordinator; implementation pending                                                                          |
| CI-02  | P3          | Missing ID surface diagnostic reads `read.error` before declaration; use the actual `raw.error`. Failure remains closed today.                                                                                                                                                 | Verification                                  | Reproduced by reviewer; minimal repair pending                                                                                           |
| DEP-01 | Maintenance | Seven advisory-affected development packages predate this PR; investigate bounded patched Vite/Vitest/Wrangler versions, verify lock and whole toolchain. Production dependency audit has zero advisories.                                                                     | Verification                                  | Bounded patch accepted; versions and final audit to verify                                                                               |
| B-01   | P2          | New revision pruning removes the last indexed protection for an existing, previously valid CSS-escaped media URL. Owner hard deletion then succeeds while the published head still uses the asset. Fail closed for uncertain legacy markup/CSS until canonical re-publication. | Backend                                       | Confirmed with actual PostgreSQL routines; coordinator independently reproduced 4 failed safety assertions after 5 passing preconditions |
| B-02   | P2          | Single-pass publisher removed the post-lock owner check. Account disable, forced password change or role revocation committed during a lock wait no longer prevents publication. Restore the second check after locks without restoring duplicate document work.               | Backend + independent reviewer                | Independent actual-PG concurrency proof, coordinator reproduced all three old-reject/new-commit cases                                    |
| F1     | P2          | Production-size canvas export in beforeunload exceeds WebKit's close-response window; actual close loses the edit while the synthetic test stays green. Make the warning decision cheap and prove Cancel, persistence and subsequent close in both engines.                    | Coordinator + frontend reviewer               | Existing loss on main; PR's new protection/test gap independently reproduced                                                             |
| F2     | P2          | Closed-tab restore checks the receiver only before asynchronous adoption/refresh; a real new name edit during the held state request is overwritten. Flush/check the receiver and make the replacement operation temporarily non-interactive.                                  | Coordinator + frontend + independent reviewer | New path introduced by PR; actual browser reproduction repeated by coordinator                                                           |
| DOC-01 | P2          | Restore specific operational recovery safeguards and four dated historical receipts; keep current guidance authoritative.                                                                                                                                                      | Architecture                                  | Mapped, bounded repair pending                                                                                                           |
| DOC-02 | P3          | Maintenance handoff incorrectly presents obsolete session constraints as current. Preserve receipt but explicitly archive its authority.                                                                                                                                       | Architecture                                  | Mapped, repair pending                                                                                                                   |
| DOC-03 | P3          | CMS release guide contains unsupported customer CLI flag and obsolete runner/file references.                                                                                                                                                                                  | Architecture + verification                   | Pre-existing command failure reproduced, repair pending                                                                                  |
| COV-01 | P3          | Restore selected real served-artifact safeguards lost with discovery/sitemap tests.                                                                                                                                                                                            | Architecture                                  | Semantically scoped tests pending                                                                                                        |

### Browser verification

- Exact pinned engines launch successfully: Chromium 149.0.7827.55, Firefox 151.0, WebKit 26.5.
- Full 125-case CMS WebKit baseline running without PR grep, local port offset 100 and separate artifacts in `/tmp/knc-audit/baseline-webkit`.

- Coordinator independently ran L1 reproduction: `/privacy.html` -> 308 `/privacy` -> 200 with `/assets/O871JQ2L.css`; importer allowlist false. Exact command in legal reviewer document.
- `npm run format:check`: PASS on the frozen tree. No baseline formatting changes needed.
- Remote main/maintenance refs rechecked during review and still match the frozen SHAs.
- Reviewers 01 and 03 completed phase 1. Reviewers 04 frontend and 05 architecture/assets now active; reviewer 06 starts when backend SQL reproduction completes. Unreviewed supporting-test and PNG paths are explicitly handed off, not marked complete from execution success.
- B-01 remains a backend hypothesis pending actual PostgreSQL16 reproduction: new pruning may remove the last indexed historical protection for an existing CSS-escaped media reference. Disposable socket-only PostgreSQL cluster created; no production data accessed.
- B-01 confirmation supersedes the preceding hypothesis checkpoint: actual publisher/extractor/index/usage/transition/prune routines on PostgreSQL16 reproduce the failure. Coordinator reran the rollback-only nine-assertion spec: five preconditions pass, four safety requirements fail; two old revisions pruned and identical owner deletion is now accepted. This is not automatic orphan sweeping. Fixture uses skeletal unrelated auth/operational tables, so full Supabase migration/integration remains a CI gate.
- Root read the changed supporting tests `workerRoutes`, `homepageBoot`, `cmsRuntimeMode`, `cmsThemeScript`, `styleTokens`, and `bundleBudget`, in addition to direct Worker cache/legal/public-page contracts. No weakening found in these behavioral assertions. Domain unit-test coverage was explicitly assigned to reviewers 04 and 06.
- The isolated CI-pinned Furl environment now passes all 17 local Python regression tests; missing-dependency gap closed.
- Root completed source/diff review of `tools/e2e/public-first-paint.mjs`, `public-checks.mjs`, and `public-smoke.spec.mjs`: real Worker startup + controlled presentation, cancellation/retry/no-script assertions, deterministic public catalog, pointer/keyboard checks and lazy-carousel fallback retained or strengthened. No deleted behavior assertion requiring restoration was found in these paths.
- `tools/e2e/fixtures/refresh-presentation.mjs` and `tests/unit/e2ePresentationFixture.test.ts` reviewed: explicit public GET is manual, normal test import does not refresh production; committed fixture is deterministic and redirected to fake backend. This is public fixture evidence, not production parity or a general secret scanner.
- Reviewer 05 visually inspected all 86 changed PNG files as 43 platform pairs; no blank/loading/failed-image baseline. Reviewer 04 reproduced existing 800px English authored review-form overflow; provenance and safe scope are being decided separately from PR-introduced defects.
- B-02: `/tmp/knc-backend-repro/owner-race.py` compares actual frozen-main wrapper/writer with maintenance on a newly created temporary PostgreSQL database, observes the lock wait, commits each revocation, then releases the lock. Main rejects all three; maintenance returns revision 1. Coordinator rerun confirms; log `root-owner-race-red.jsonl`. Every publication rolled back and the created database was dropped.
- Native Git push dry run found no GitHub credentials in the shell. The authorized GitHub connector remains available for content-addressed tree/commit/ref publishing; use it for batches and verify tree identity against local Git. No branch or remote commit has been changed yet.
- Connector repository permissions confirm push/maintain/admin access. Publishing will use a main-parent commit pointing at the exact frozen maintenance tree, then scoped repair commits; existing branch refs remain unchanged.
- Implementation isolation decision: keep `/tmp/knc-pr90` frozen for the running full WebKit baseline. Once all six maps close, create `/tmp/knc-pr90-repair` for the replacement branch, with disjoint legal/backend/docs ownership and an additional CI/dependency worktree so dependency installation cannot disturb other runs. Four Max implementation agents work in waves; coordinator integrates and reviewer 04/06 challenge the fixes independently.
- B-01's independent variant challenge also reproduced URL dot segments in the prefix and path, including percent-encoded dot segments. A backslash-only repair is insufficient. The final guard and regressions must cover these supported legacy encodings, ordinary canonical content, and non-markup prose without silently rewriting authored data.

### Mapping close checkpoint

- Reviewer 05 completed exact 41/41 documentation paths, all 40 deletion dispositions, 34/34 moved E2E assertion calls, and all 86 PNG contents (43 platform pairs). Four operational receipts will return as dated archives; 28 other deleted documentation paths remain deleted. The concise map stays.
- Accepted DOC-01 restores specific recovery rules (stable PUBLIC_ACTION_HASH_SALT, additive receipt lifetime, compatible cookie/signature paths, non-destructive recovery and authoritative provider ledgers); DOC-02 archives obsolete handoff instructions; DOC-03 repairs stale release commands. COV-01 restores semantic served-artifact legal/discovery safeguards.
- Accepted F1 (P2, pre-existing loss / new protection gap): actual WebKit close after a pending production-size canvas edit gives no warning and loses the edit. Main also loses at that boundary; PR90 adds protection but its WebKit test substitutes a synthetic event. Actual app beforeunload takes about 500 ms. Independent minimal WebKit controls prompt with a fast handler and suppress the prompt with 200 ms work even if cancellation is set first. Repair must make the decision cheap and verify actual close/Cancel/durable-backup behavior, without promising retention after explicit Leave.
- Existing English 800px fixture overflow reproduces identically on main (846px light, 825px dark), caused by owner-authored translation. Preserve that content and disclose the limit; do not mask it with global clipping or alter screenshot baselines.
- Reviewer 03 is completing previously partial/pending browser-source coverage; reviewer 06 is mechanically reconciling the full 447-path ledger. Mapping is not yet marked complete.

### Exact coordinator supporting-test closure

| Status   | Path                               | Evidence / disposition                                                                                                                                                                                                                   |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed | `tests/unit/cmsPublicPage.test.ts` | Full current file and changed assertions reviewed during Worker/public serving trace; render boundaries, variants, island placement and legal/public page behavior checked against shared implementation. No additional accepted defect. |
| Reviewed | `tests/unit/workerCache.test.ts`   | Full current file and diff reviewed; immutable version cache, revision mismatch, timeout/no-store and response-body contracts checked against Worker. No additional accepted defect.                                                     |

- F2 coordinator reproduction: real name input accepted `Newer recipient edit`, dirty-only revert became enabled and sidebar changed while the state response was held. After release and the actual recovery notice, name became `Closed tab draft`; intended final safety assertion failed. `/tmp/knc-audit/root-restore-race-red.log`. Main has no closed-tab-offer path, so this is a PR-introduced recovery race.

### Mapping phase closed

- Independent exact-path reconciliation: **447/447 changed paths reviewed; 0 uncovered**. Source/diff review, visual overview review and execution evidence remain distinct. Historical incomplete checkpoints are superseded by the explicit completed rows, not erased. Six Max-reasoning reviewers completed their mapping work.
- Four implementation owners: legal/source import (01), backend integrity/security (02), verification/dependencies (03), operational documentation/served-artifact guards (05). Coordinator implements F1/F2; reviewers 04 and 06 challenge repairs independently.
- Ref lease immediately before branch creation: main and maintenance still equal frozen SHAs; `fix/pr90-reviewed-maintenance` does not exist. Frozen maintenance has 25 successful checks and one external Supabase Preview skip.

- Replacement snapshot commit: `49f0fbd8c24403dc2f1717c58d3212ac9202b509`; tree `8fe9fb8fc0f2813588bd1e961f2b5e70ef7156cf`, identical to frozen maintenance; sole parent is frozen main. Repair and CI worktrees are isolated; frozen baseline stays unchanged.
