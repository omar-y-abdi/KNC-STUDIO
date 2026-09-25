# CMS unified resources — committed checkpoint

## Read this first

This is an **unfinished draft PR**, not a completed CMS delivery or permission to merge.
The owner requested: commit the existing work, push it and open a PR. No further feature implementation is part of this checkpoint.

- Repository: `omar-y-abdi/KNC-STUDIO`.
- Local checkout: `/Users/k/dev/barber/project`.
- Continue on `fix/cms-unified-resources-20260924`, targeting `main`.
- Main baseline: `f3adf076ac0665c331859ccb0b48da4e9b0c7d31` (merged PR #77).
- R4 work-in-progress commit: `4a46e460e66477706201f2868556b5ea9a2234eb`.
- Main alignment commit: `092215e5d25ce61545fbf177519ace3b6ea34248`.
- Before merging main into this branch, its tree was verified identical to the former PR #77 head `ff1e8b3`. The merge preserves this checkpoint's exact source tree, `39f7226c325e70d38e24570171664d95995f0c0d`, while removing already-merged PR #77 changes from the PR diff. Prior task commit IDs remain valid.

All working documents belong under `docs/`. The [canonical plan and chronological evidence ledger](../superpowers/plans/2026-09-24-cms-unified-resources.md) remains the detailed record. This handoff supersedes its older checkpoint statuses; do not reimplement tasks simply because an earlier table says pending.

## User-reported problems

The upload succeeded but subsequent resource usage inspection failed with request ID `03308984-77cc-4c87-b6f7-0164308de793`. Home/About were separate editing destinations although they form one public page. Barber groups/cards did not resize their children or equivalent peers consistently. Resource categories did not represent actual usage or support clear assignment/reuse. Profile/logo/SVG double-click replacement was incomplete. Built-in website graphics/controls were missing from Resources. New authored-page headers did not fit mobile correctly.

The owner explicitly deferred deep investigation of the intermittent white-page/damaged-draft incident unless existing logs directly identify it. Its root cause remains unconfirmed. Do not reset or delete drafts, and do not expand that deferred investigation silently.

## Saved implementation map

| Task                            | Commit(s)                       | Boundary / remaining acceptance                                                                                                                                    |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1: upload-followup error       | `ced0b41`, `2d9f300`, `c6b7073` | Indexed historical media usage; local error/retry instead of a false upload failure. Production rollout/history recorded below.                                    |
| E1: unified Home/About          | `c250005`                       | Canonical About tree editable from Home; separate storage owner and public route retained. Extended language/style/undo acceptance remains.                        |
| E2: linked hierarchical resize  | `be97299`                       | Proportional barber geometry and equivalent peers; preserve person-specific content and device isolation. Accumulated regression review remains.                   |
| E3: authored mobile header      | `f048191`                       | Compact responsive seeded header and focused browser scenario.                                                                                                     |
| R2: assignable resource library | `360baca`                       | Category filters, upload destination/person, reusable scoped copies and reversible draft assignments. Real Edge/storage integration remains.                       |
| R3: coherent resource rendering | `e4b7a17`                       | Draft assignment and refreshed Home/About layout form one reconciled transaction; read-only preview uses draft resources.                                          |
| R3: contextual double-click     | `c1cb288`                       | Actual iframe double-click delegation, scoped barber library and persistence test. Complete gallery/logo/decorative SVG coverage remains.                          |
| R4: built-in graphics/controls  | `4a46e46`                       | **WIP only.** Inventory/mutation helpers, unused component view and an intentionally failing standalone browser scenario are saved. No navigation integration yet. |

Resolve any implementation with `git show <commit>`. Documentation commits are not substitute evidence for a production fix.

## Fresh checks run for this checkpoint

Evidence directory on the owner's Mac: `/Users/k/dev/barber/cms-unified-evidence/push-checkpoint-20260925/`.

- Prettier applied only to the three previously untracked R4 files; exit 0. No feature wiring or behavioral rewrite.
- ESLint on those same three files: exit 0.
- `npm run typecheck`: exit 0, no diagnostics.
- `node_modules/.bin/vitest run tests/unit/cmsResourceAssignment.test.ts tests/unit/cmsAssetCopy.test.ts`: exit 0; **9 tests passed across 2 files**.
- `results.json` and individual logs retain these exact results.

The earlier two R4 TypeScript errors are fixed and now included in `4a46e46`: parse5 `html.NS.HTML` replaces a plain namespace string, and the existing `sliders` icon replaces nonexistent `settings`.

These checks do **not** mean R4 works or that the full branch/CI passes. No new full browser sweep, production build, deployment or production content write was performed when preparing this checkpoint. The new PR may trigger normal CI; inspect its actual head results separately.

## Existing evidence, not rerun at checkpoint

The chronological plan links local red/green results for the indexed SQL lookup, unified Home, assignment workflow, hierarchical resize and mobile header. It also records Chromium/WebKit passes for `cms-contextual-resources.mjs` and `cms-draft-resources.mjs` (assignment, undo/redo, locked preview and intercepted publication/reload). These browser fixtures intercept backend boundaries; they are not authenticated production publication evidence.

`cms-site-resources.mjs` previously failed waiting for the missing **Webbplatsens resurser** button (`R4-red.log`). That entry point is still absent. Keep the test assertions; do not call this feature complete or silently remove the test because it is red.

## Exact next work

1. Finish R4 in `shared/cms-site-resources.ts` and `src/admin/cms/SiteResources.tsx`, then integrate it into resource navigation. It is currently not imported by the application. Run the existing `tools/e2e/cms-site-resources.mjs` reproducer before and after the integration.
2. Review R4 draft mutation/projection boundaries before exposing the UI: decorative SVG-to-image projection currently differs from the helper's broad replacement eligibility; preserve required children/callbacks, native identities, per-language nodes and concurrent edits. Review deferred input-value access in the logo text handler. Add focused regression evidence instead of treating successful TypeScript compilation as behavior verification.
3. Extend contextual selection to the requested gallery/logo/profile/decorative graphics cases; verify real double-clicks and non-stacked modal behavior. Finish E1 language/style/undo coverage and retest E2/E3 with the accumulated changes.
4. Validate `asset_copy` against the real isolated local Edge/database/Storage stack, including lifecycle races, destination scope and idempotent reuse. Run the release-stamp check and deploy the matching reviewed `cms-studio` before a frontend that invokes the new operation.
5. Run accumulated-change checks, inspect the PR's CI failures at their root causes, review the full diff and visually inspect the affected views before marking ready. Existing tests that navigate to a separate About editor may need updated workflows, not removed assertions.

Use the existing isolated fixture server on port 4199 only after confirming its configuration. Otherwise start it explicitly:

```sh
VITE_SUPABASE_URL=https://admin-harness.invalid VITE_SUPABASE_ANON_KEY=e2e-public-anon-key npm run dev -- --host 127.0.0.1 --port 4199 --strictPort
```

Focused R4 command, with logs/screenshots outside tracked source:

```sh
BASE_URL=http://127.0.0.1:4199 CMS_ENGINE=chromium CMS_EVIDENCE_DIR=/tmp/knc-site-resources-chromium node tools/e2e/cms-site-resources.mjs
```

Repeat with WebKit and a distinct evidence directory. Do not use production credentials in these browser fixtures.

## Production boundaries and stop point

The existing ledger records that the historical-reference index migration was applied to production as **`20260924223012`**, and the repository filename/local migration bookkeeping were aligned in `c6b7073`. This checkpoint does not reapply it. Recheck migration history before any future database action. The ledger's earlier measured lookup results are historical, not a fresh production measurement here.

The new `cms-studio` **`asset_copy` deployment is not signed off**. Keep the checked-in release fingerprint and deployed backend synchronized through the existing release workflow. Do not assume the earlier `upload-image` deployment deployed this different Function.

No merge, production publication, new deployment, migration, backup deletion or booking change is authorized by merely taking over this checkpoint. The local R4 work has been preserved, not finished. Continue on this PR branch and retain the small task commits.
