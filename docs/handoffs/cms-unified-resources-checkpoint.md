# CMS unified resources — current continuation checkpoint

## Resume here, not at the historical WIP notes

Repository: `omar-y-abdi/KNC-STUDIO`. PR **#78**, branch
`fix/cms-unified-resources-20260924`, checkout `/Users/k/dev/barber/project`.
The base is `f3adf076ac0665c331859ccb0b48da4e9b0c7d31` (merged PR #77).
All working documentation belongs under `docs/`.

**The product features below are implemented and committed. R4 is integrated.**
The former version of this handoff incorrectly told fresh agents to implement them
again. It is historical in Git, not the current task. Read this summary and the
latest entries in the [canonical plan/ledger](../superpowers/plans/2026-09-24-cms-unified-resources.md),
then inspect `git status`, `git log` and the current PR checks before editing.

Latest product correction: `eef3cee` (visual swaps preserve semantic alt text).
The resume work changes tests, CI coverage and documentation, not product code.

## Verified implementation map

| Task                                         | Implementation commits                     | Focused contract                                                                                                                       |
| -------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| R1: upload succeeds, usage lookup times out  | `ced0b41`, `2d9f300`, `c6b7073`            | Indexed revision media, local usage error/retry; SQL test 62 and `cms-resource-usage.mjs`                                              |
| E1: editable About on Home                   | `c250005`, `bb6a5f3`                       | Canonical ownership, bounded CSS, mixed selectors, languages/undo/save/reload; `cms-unified-home.mjs`, `cms-composition-roundtrip.mjs` |
| E2: hierarchical and linked barber sizing    | `be97299`                                  | Proportional geometry, peer identity/content preservation, device isolation; `cms-hierarchical-resize.mjs`                             |
| E3: independent-page mobile header           | `f048191`, `924b47e`                       | Mobile sizing and publication/reload; `cms-new-page-mobile.mjs`                                                                        |
| R2: categorized reusable assets              | `360baca`, `5d0f97c`                       | Destination/person, activation, cross-scope reuse; `cms-resource-workflow.mjs`, real local `cms-asset-copy.mjs`                        |
| R3: draft capture and contextual replacement | `e4b7a17`, `c1cb288`, `b1d1b97`, `51af072` | Atomic draft/render update, concurrent edits, logo/profile targets; draft/contextual-resource tests                                    |
| R4: existing website graphics and controls   | `b9c05dd`, `51af072`, `eef3cee`            | Integrated inventory, protected graphics, contacts, semantics; site-resource and graphic-projection tests                              |

`git show <commit>` resolves each implementation. Documentation commits are not
substitute evidence for a fix. Canonical `/about` storage and the public `/about`
route remain: only the redundant editor destination was removed.

## Current final-verification issue and correction

CI run `36181560039` on `4277d85` failed three **old editor navigation contracts**:
`cms-responsive.mjs`, `cms-populated.mjs` and `cms-barber-marquee.mjs` still clicked
the removed Om oss editor button. The public website's Om oss navigation is valid
and was not removed. The original responsive failure was reproduced locally before
editing (`pr78-final-review/responsive-before.log`, exit 1).

Commit **`1cc2dc7`** routes those tests through Home and scopes mobile barber edits
to the canonical About subtree, not the hidden inactive-device preview. Existing
layout, identity, public-route, style, booking, publication and reload assertions
remain. No forced clicks or increased timeouts were introduced.

Fresh local results: responsive and populated suites pass in both engines;
marquee passes in Chromium and in an isolated WebKit run. A concurrent WebKit run
stalled during a visible Mobile-button click after reload; unchanged code passed
with API tracing when run alone. This observation is retained, not assigned a
proven infrastructure cause. Final CI must independently pass.

Commit `2082b19` gives the ten newly added feature suites a dedicated `CMS unified resources`
workflow. The real local Edge/Storage copy test is also added to the main database
job with its allowed CI origin. These gates are not satisfied by old unrelated
workspace results. Missing suite outcomes fail, and per-suite logs are preserved.

## Backend and fresh local verification

Read-only production checks confirm migrations `20260924223012` and
`20260925011000` already exist. `cms-studio` is ACTIVE **v11**, JWT verification
is enabled, and `node tools/release/cms-release.mjs verify` matches
`00c4d49b27d53f1a20d425230cb2116d398b0daa1a2339db8c329ef3c4bc2563`.
Do not redeploy or reapply those migrations merely to resume this task.

Fresh focused unit run: 25 assertions across cmsSiteResources, cmsAssetCopy,
cmsResourceAssignment and cmsHierarchicalResize pass. Changed-file ESLint,
Prettier and `git diff --check` pass. Current changes are tests/CI/docs only;
full product test/build results remain in the preceding ledger and are repeated
by final CI rather than repeatedly burning the owner's laptop on unchanged code.

The first fresh local `cms-asset-copy.mjs` failed before copying at a state read
with gateway `name resolution failed`. Docker inspection showed the local Edge
container had exited hours earlier while Kong and PostgreSQL remained healthy.
Starting **only** `supabase functions serve --env-file supabase/functions/.env`
restored the local boundary. The unchanged test then passed authenticated upload,
byte parity, concurrent reuse, all destinations, denied stale/unauthorized calls,
and unchanged CMS document. Its temporary test assets/account were cleaned up.
No production write was involved and no database reset was performed.

Evidence home: `/Users/k/dev/barber/cms-unified-evidence/pr78-final-review/`.
Keep earlier failure logs alongside the passing results. Existing fixture Vite is
on 4199 with `admin-harness.invalid`, not production credentials.

## Exact next steps

1. Inspect the current head and PR #78 checks. Commit/push the scoped navigation,
   permanent-gate and documentation updates if they are not already in Git.
2. Require all main CI, workspace, production-startup and unified-resource jobs
   on the exact new head. Investigate any failure at its first broken boundary;
   do not reimplement the already integrated R4 or disable an assertion.
3. Review the accumulated product diff and actual relevant screenshots. Update
   this checkpoint and PR metadata with exact commits/results; mark ready only
   after verification. Do not merge or publish owner content automatically.

Focused local execution, when needed:

```sh
BASE_URL=http://127.0.0.1:4199 CMS_ENGINE=webkit node tools/e2e/cms-unified-home.mjs
BASE_URL=http://127.0.0.1:4199 CMS_ENGINE=webkit node tools/e2e/cms-barber-marquee.mjs
CMS_TEST_ORIGIN=https://127.0.0.1:4197 node tools/e2e/cms-asset-copy.mjs
node tools/release/cms-release.mjs verify
```

Limit concurrent local browser workers to two; use separate evidence folders.
The asset-copy test rejects non-local API/DB/origin targets. Never put production
credentials in the browser fixtures or reset the populated local stack to make a
test pass. Leave unrelated processes/worktrees alone.

## Explicit remaining uncertainty

The owner's intermittent white-page/damaged-draft incident is still the expressly
**deferred** investigation: no existing logs identified its exact root cause.
Do not claim other fixes diagnose it, delete backups, or broaden that work silently.
