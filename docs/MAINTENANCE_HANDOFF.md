# Maintenance recovery — 2026-10-25

This is the current recovery entry point. `docs/REPO_IMPROVEMENT_PLAN.md` records the
original scope and owner decisions. The old local `PLAN.md` has stale batch statuses;
`.claude/runtime/handoff.md` contains the chronological session history and failure evidence.
Those two local files are excluded by `.git/info/exclude`, so this handoff is committed.

## Current branch split

- `maintenance` starts at `polish/2026-10` (`9b5c38d`). It includes the previously
  integrated work, plus `batch/ci` (`11b90a7`), `batch/unit-pins` (`03782b4`),
  `batch/e2e-cleanup` (`2adb2b7`) and `batch/docs-map` (`db3e554`).
- The independently completed SQL cleanup `cc844e6` is cherry-picked with its source
  commit recorded. Merging `batch/squash` would also import unfinished delivery-log work.
- These completed batches still require a fresh GitHub CI result on their combined tree.
  Local historical passes are evidence about their original commits, not this new branch.
- `int/wave-d` (`5884d5b`) preserves the remaining CMS/admin work and integration fixes.
  It is not accepted as finished: its last full local gate was red.
- Leave both PRs unmerged for the owner. Do not deploy, apply production migrations,
  publish CMS data, delete old worktrees or rewrite existing history.

## Git audit

After fetching `origin`, `origin/main` is `f15b79b`. The old `polish/2026-10` contains
218 commits beyond it; `int/wave-d` contains 293. Every `batch/*` head is an ancestor
of `5884d5b`, and `polish/2026-10` is also an ancestor. The forward-merge chain is:

`polish/2026-10` → `int/wave-a` → `int/wave-b` → `int/wave-c` → `int/wave-d`.

`int/b1f` and `int/cms` have old merge commits outside that ancestry, but no unique
non-merge commits. There is no evidence that completed batch commits were lost through
unsynchronized branches. The main checkout was behind the integration branch.

All existing batch/integration worktrees were clean, except untracked `dist-pages/`
in `wt/pages`. The main checkout also has two untracked recovery gate scripts. Keep them.

## Verification policy for this recovery

- Use git and `gh` CLI, not the GitHub MCP connector.
- No local tests, builds, browser runs, database stacks or type-check runs.
- Local checks are ESLint and Prettier. Regenerate the CMS release stamp when its
  source files change; this only writes compatibility metadata and runs no tests.
- GitHub Actions executes the test/build/database/browser pipeline. Fix red CI on
  `maintenance` before starting remaining WIP implementation.
- Use at most four GPT-6.1 Sol agents, medium reasoning, for remaining work. They work
  on separate branches/worktrees based on the latest accepted predecessor.
- Review actual diffs and important boundaries. Return concrete findings to the same
  agent. Commit and push accepted changes; require CI green before advancing the chain.
- Before publishing a later branch, merge the latest predecessor into it and resolve
  conflicts. Open the next PR against that predecessor so the owner can merge in order.

## Remaining implementation and known failures

The remaining tree adds D2 pages, D4 editor controls, E6 startup, E1b part 1,
D3y pristine/edited state, C4 contact, and E3/E3b admin/email delivery changes.
F2/F1a/F1b/F3 and F4 part 1 are now separated into the maintenance baseline above.

Existing failure evidence belongs to `5884d5b`. Historical gate log:

`/private/tmp/claude-501/-Users-k-dev-barber-project/445d0587-4dc9-457b-87b9-c80a8f42ec10/scratchpad/gate-wave-d2.log`

Its recorded outcomes: 1780 unit tests passed, public 308 passed, startup 12 passed /
2 failed, CMS Chromium 137 passed / 5 failed, CMS WebKit 132 passed / 9 failed.
The failures are:

- Contact adoption/import and recovery after settings edits/conflicts, both engines.
- Barber marquee flow, both engines.
- A 409 merge must preserve layouts made stale by an edit during publication, both engines.
- WebKit page-path validation, narrow-desktop resize, backup on hide/close and legacy zoom.
- Real-fixture startup timing on both engines. Load contention was a hypothesis in the
  prior handoff, not a proven root cause. Do not raise budgets without evidence.

Read the corresponding `gate-wave-d2.{chromium,webkit,startup}.txt` and artifact directories
beside that log. GitHub CI on the recovered branch is the next execution evidence.
PR CI intentionally selects only owner/mobile/barber-marquee WebKit files; a green PR
alone does not prove the full WebKit matrix. Run the existing full-matrix workflow on
the final WIP branch before claiming all known WebKit failures fixed.

## Owner-dependent work retained

- E1b part 2 waits for the owner's first CMS publish after rollout.
- F4 part 2 (migration squash/production history repair) waits for owner approval.
- B2/E4 and email-log migrations/functions need an explicitly approved deployment order.
  Deploy the matching CMS backend before its frontend; see `docs/operations/CMS_RELEASE.md`.
- Native Supabase Auth emails bypass the new email delivery log.
- Keep the existing instructions about one post-rollout Studio publication, Swedish
  contact copy/labels and the remaining actual-device Safari checks.

No production state or current deployment was checked during this recovery.

## CI recovery receipts

Maintenance PR: [#90](https://github.com/omar-y-abdi/KNC-STUDIO/pull/90).
Use its current head checks for acceptance; earlier runs do not validate later commits.

The [initial run](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/40225152010)
exposed three test-infrastructure faults: compressed fixture bytes differed, the report
verifier rejected intentional network-guard failure probes, and the first-paint fixture
missed revisioned presentation requests. The fixes preserve the committed fixture,
exact decompressed document bytes, planned outcomes, and original pixel/hero assertions.
Both repair diffs received orchestrator and independent read-only review.

The [next run](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/40226246068)
found a TypeScript error in the repair's Buffer equality call. The follow-up uses
`node:util.isDeepStrictEqual`, retaining exact byte equality and compact failure output.
Local verification remains lint/format only; GitHub owns runtime/type verification.

## Zod security migration — pending GitHub verification

The maintenance audit reached [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
whose patched version is 4.6.6. The root npm dependency, every function import map and scoped Deno
frozen lock now pin that version. npm metadata resolution changed only the Zod lock entries;
shared `node_modules` was not installed or changed. GitHub must verify the production audit,
TypeScript, Deno checks, tests and browser paths on this combined tree.

The [official Zod 4 migration guide](https://zod.dev/v4/changelog) changes several boundary APIs.
The migration preserves the existing UUID shape with `z.guid()`, string-valued discovery settings
with an explicit record key schema, CMS custom/Swedish errors and absent unconstrained fields.
`shared/iso-timestamp.ts` preserves the old Gregorian date/time pattern, including minute-only
times and basic offsets; Zod 4's native datetime schema narrows those accepted forms. Unbounded
response integer fields use `Number.isInteger` to preserve their prior range; CMS revision/version
fields retain their safe-integer restriction. Zod 4 rejects infinite plain numbers, which cannot
arrive through these JSON wire boundaries. The default email pattern was checked against the
4.6.6 release source; its rewritten expression preserves the existing ASCII email language.

The old public-form parity oracle intentionally imports `zod/v3` in its test file only: it
compares plain validators against the removed implementation, including its original messages.
Production imports use the patched v4 API. New boundary regressions cover UUID, timestamp, record,
integer, absent-field and strict-error behavior. They have not been executed locally under the
recovery policy.

Residual library behavior is explicit: the three upload-response `publicUrl` schemas in
`src/admin/adminSchemas.ts` retain `.url()`. Zod 4 normalizes leading/trailing whitespace and
embedded tabs/newlines in those URL strings, whereas Zod 3 returned the original strings. The
backend generates canonical URLs, so this difference has no demonstrated product failure; the
migration does not claim complete byte-preserving parity for arbitrary URL inputs. Uncustomized
English library error messages also follow Zod 4; application-authored messages remain pinned.
