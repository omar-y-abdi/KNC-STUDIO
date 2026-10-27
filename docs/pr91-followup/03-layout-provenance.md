# PR91 follow-up — F3/F4 layout provenance

## Scope and acceptance

- Author worktree: `/tmp/knc-pr91-layout`, branch `review/pr91-layout`, frozen starting head `d800bad059271da7624bf0ae98e79ba2a1fb313f`.
- This is an authorized repair of F3/F4 in the user-supplied 27 October review. The coordinator owns integration and remote publication; this worktree makes no production calls or remote writes.
- F3 acceptance: failed resource capture, another edit, successful publish, Undo and another publish must recapture stale Home/About HTML or stop publication.
- F4 acceptance: historical staff reconciliation must invalidate HTML for different staff, including changes with no portraits; the published public rendering must agree with current staff data.
- Preserve authored layout overrides. Use existing draft/provenance/rendering seams and dependencies; no new persistence model or framework.
- Adjacent backup/adoption sections are owned by other authors. Coordinate Studio interface changes before implementation.

## Tasks

- [x] Read the supplied report, relevant source, callers and existing test harnesses.
- [x] Add correct-behavior regressions and reproduce F3 and F4 on the frozen source, including full Studio sequences.
- [x] Implement the smallest fixes supported by the reproductions and review the provenance lifecycle across publish, Undo/Redo, merge and restore.
- [x] Run the unchanged reproductions green, inspect real rendered public output, and verify affected supporting contracts.
- [x] Record exact receipts and limits, incorporate the coordinator's independent challenge, and format the scoped changes for commit.

## Initial evidence and hypotheses

- `LayoutProvenance.follow` currently copies only an explicitly registered source. `stale` falls back to the caller's current base, allowing an unregistered historical document to change meaning after publication advances that base.
- `layoutResourceKey` currently includes gallery, photos and visual settings but omits staff data. The history path registers reconciled documents against the historical revision's resource key.
- Ranked hypotheses for F3: (1) mutable-base fallback loses historical capture identity; (2) publication amendment/Undo chooses a different document than expected; (3) capture or public projection normalizes the mismatch before publication. The browser regression will distinguish these through capture attempts and submitted HTML/data.
- Ranked hypotheses for F4: (1) missing staff key permits old card HTML; (2) restore normalization or editor export repairs it later; (3) public rendering repairs it. The regression will exercise real history restoration and inspect Worker-rendered HTML with scripting disabled.
- Full source trace includes `Studio.tsx`, `draft.ts`, `HistoryPanel.tsx`, `draftReadSnapshot.ts`, `captureResourceLayouts.ts`, `layoutProvenance.ts`, the local backend and existing Worker rendering harness. The actual staff projection uses identity, name, Instagram and both language variants of role/bio; roster identity also controls which current staff cards exist.
- Both hypotheses are confirmed by unit and full Studio red runs. `follow(previous, next, base)` now freezes the previous snapshot's inherited layout source and copies it to the next snapshot. First `stale` evaluation also records its fallback; successful merges explicitly record their current source. The staff key adds only projected identity/name/Instagram/role/bio fields. Studio supplies the contemporaneous base at both follow call sites.

## Verification receipts

- Red unit command: `node node_modules/vitest/vitest.mjs run tests/unit/cmsLayoutProvenance.test.ts` on the frozen product source. Result: **2 failed / 6 passed**. Both new correct-behavior assertions expected stale `true` and received `false`. Receipt: `/tmp/knc-audit/pr91-layout-red-unit.log`.
- Corrected red browser command: `E2E_GROUP=cms E2E_PORT_OFFSET=400 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-layout-red node node_modules/@playwright/test/cli.js test cms-layout-provenance.spec.mjs --project=cms-chromium`. Result: **2 failed** at the intended no-stale-publication assertions. F3 submitted publication 3 with the gallery image present in data but absent from HTML; F4 submitted publication 2 with current staff data but former-only staff HTML. Both had **zero capture attempts** at the guarded publication and no page errors. Receipts: `/tmp/knc-audit/pr91-layout-red.log` and per-case `evidence/undo-publication.json` / `evidence/staff-publication.json`.
- Browser regressions use actual Studio controls, isolated `nativeBackend`, and the existing real Worker rendering harness. Artifacts use `/tmp/knc-audit/pr91-layout-red` and `/tmp/knc-audit/pr91-layout-green`; browser ports use `E2E_PORT_OFFSET=400`.
- Initial green: **20/20** focused unit cases across provenance, history restore, draft and draft preview; TypeScript and scoped ESLint passed. The original two browser cases passed in Chromium and WebKit: **4/4**, including failed-recapture publication rejection, successful retry and JavaScript-disabled public DOM from the actual Worker page renderer. Receipt: `/tmp/knc-audit/pr91-layout-green/test-results/results.json` (3.6 minutes).
- Final browser command: `E2E_GROUP=cms E2E_PORT_OFFSET=400 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-layout-final-green node node_modules/@playwright/test/cli.js test cms-layout-provenance.spec.mjs --project=cms-chromium --project=cms-webkit`. Result: **6/6 passed** in **304.1 seconds**. Three cases run in each engine: F3, portrait-free F4, and the retained-staff-order control.
- The actual `tools/ci/verify-playwright-report.mjs` compared scoped discovery against final results and confirmed **six cases, no skips, retries or missing outcomes**. Receipts: `/tmp/knc-audit/pr91-layout-final-green/expected.json`, `test-results/results.json`, and `/tmp/knc-audit/pr91-layout-final-green.log`.
- At each deliberately blocked publication, the browser receipts record exactly **one capture attempt**, no additional publication and no page errors. After unblocking, publication succeeds and the public DOM contains the gallery image element or current staff, with the former staff absent. The retained-staff control additionally compares published numeric staff order with actual public DOM order.
- Final supporting verification: **20/20 tests in four files** (`cmsLayoutProvenance`, `cmsHistoryRestore`, `cmsDraft`, `cmsDraftPreview`), TypeScript application/test checks, scoped ESLint, Prettier and `git diff --check` passed. Unit receipt: `/tmp/knc-audit/pr91-layout-final-unit.log`.
- The author inspected the Chromium public screenshots for F3 and portrait-free F4. The F4 screenshot visibly contains the current staff name. Public DOM assertions use Swedish/light mode at desktop width; the real capture function itself still performs its existing language/theme/device capture loop.

## Independent completeness challenge

- The coordinator identified that the final publisher also writes `barbers.sort_order`. A same-member historical restore can legitimately retain its matching old HTML, so that case alone is not another finding. A reconciled roster with retained staff whose historical order differs from the live catalog is the relevant F4 completion case: required recapture must project the order publication will write.
- The active catalog definition is `20260824092548_public_booking_catalog_service_weekdays.sql`, which orders staff by `sort_order`, then `name`; `supabaseBookingCatalog.ts` preserves that returned order while stripping the ordering number from its display adapter.
- The isolated draft-preview assertion was red, but the full Studio/history/public-render counterpart **passed without a sorting change**. Restored data and actual public HTML both order retained staff Alfa, Beta, then the current newcomer, despite the live catalog having reversed the retained staff. Receipt: `/tmp/knc-audit/pr91-layout-order-red/test-results/results.json` and `evidence/staff-order.json` (the directory name records the attempted counterexample, not an actual failing result).
- `NativeSurface.tsx` projects existing template children in stored order and appends genuinely new live entities; it deliberately preserves owner placement. Thus adapter array order alone was not the visible contract, and the helper-only sorting expectation was unjustified. The coordinator agreed to reject that hypothesis for the reproduced sequence. The failing helper test was removed, no sorting/projection code was added, and the passing full Studio case remains an F4 control.
- The key therefore covers the staff identity and labels actually projected into retained layouts. It does not claim that publication's numeric staff order overrides owner-authored card placement.

## Limits and errors

Local F3/F4 verification is complete. Browser harnesses use an isolated test backend; SQL publication and production authorization are outside the focused F3/F4 reproduction boundary. The coordinator still owns combined integration, release stamping, remote publication and exact-head CI.

- Initial browser harness run exposed two test issues, not accepted product reproductions: its completion check waited for a publish button that is disabled after a successful publication, and its staff fixture populated discovery but not the actual booking-catalog RPC. The polling now observes publication/error settlement and both public RPCs use the controlled current roster. Initial diagnostics are retained in `/tmp/knc-audit/pr91-layout-harness-diagnostics`; the corrected red run still uses unchanged product source.
- The broader Worker fetch helper did not implement `public_cms_page_metadata` for `/about`; the public assertion now calls the actual `renderCmsPage` function via the existing Worker loader and serves that HTML to a JavaScript-disabled browser. This verifies real stored-page rendering, without claiming the whole HTTP/auth/SQL boundary. Superseded and interrupted harness runs are retained as diagnostics, not green evidence.

## Final author disposition

F3 and F4 are accepted, reproduced and repaired. Historical layout source identity now survives publication and Undo, and reconciled staff identity/copy invalidates historical layouts even without portrait changes. Failed captures retain the draft and prevent stale publication; successful retries produce matching public HTML. No dependency, schema, staff sorting, ownership model or unrelated backup/adoption change was added.

The coordinator independently challenged prior-snapshot freezing and the F4 ordering boundary. The fix freezes prior and descendant identities; the full ordering control rejected an unnecessary sorting change. Adoption's separately authored migration callbacks must pass their owning draft's `base` as the new third `follow` argument when the branches are combined.
