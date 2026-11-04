# WIP recovery after PR #91 — 2026-10-28

## Baseline and authorization

The owner merged PR #91 as main `93ff32985052a42b9215db210ad5e6951aad5a65`.
PR #90 is closed.

Production deployment, migration and CMS publication remain outside this PR task.

## Recovery source

Preserved WIP: `int/wave-d` at `5884d5b372d63a42b79214c94aee15a904951ffd`.
Its last historical gate was red. Its claims must be reconciled with #91 repairs.
The original net delta starts at `polish/2026-10` (`9b5c38d`). Local recovery source
`recovery/wip-source-2026-10` (`d7bba13`) has that parent and the exact WIP tree.
Applying this delta onto current main preserves the replacement history from #91;
old maintenance commits are not merged back into the new PR ancestry.

Scope: D2 pages, D4 editor parity, E6 editor startup, E1b part 1 normalization,
D3y pristine state, C4 contact, E3 single-writer admin and E3b delivery logs.
Keep render-time CSS repairs pending owner publication. PAR14 key deletion remains
rejected because presentation.regions has readers. Production rollout and migration
squashing remain owner-dependent. Native Auth emails remain outside delivery logs.

## Agent ownership and order

1. A / wip_integration: recover baseline, reconcile #91, then CMS lifecycle/contact,
   source import and public rendering. Branch `wip/cms-lifecycle`; the coordinator
   integrates into `wip/complete-2026-10`.
2. B / wip_admin: admin single-writer cleanup, delivery log/backend boundaries.
   Branch `wip/admin-delivery`. Initial audit only; synchronize to recovered baseline
   before edits. Preserve current Zod boundary semantics and authorization.
3. C / wip_editor: Editor and canvas/page controls, geometry, zoom and startup.
   Branch `wip/editor-layout`. Initial audit only; synchronize before edits.
4. D: independent adversarial review of source changes and named invariants, read-only.

Coordinator records exact file ownership before parallel editing. Shared files are
sequenced. Every completed author branch absorbs the latest accepted aggregate before
integration. Findings return to the same author with regression coverage. Author
claims alone never constitute acceptance. The coordinator reviews dangerous boundaries
and personally runs gates on the integrated tree. The independent reviewer attacks the
full main-to-final diff, including originally authored WIP.

## Gates

Preserve #91 backup locks, same-page recovery/source cache, pending-edit exit, historical
layout provenance, legal-byte preservation and Reset parse budget. Preserve current
publication authorization/retention repairs, Zod4/CSP, shell parser, all-engine CMS CI,
Calendar contract and operational documentation. No lowered budgets, relaxed assertions,
retries or replacement screenshot baselines to obtain green.

The gates run in CI on the stack PRs (#119 to #138) and on #104: static, unit and build
gates, public/admin/visual, CMS Chromium/WebKit and startup browsers, Edge Functions,
current-schema, integration and customer browsers, and historical database compatibility.
Keep every configured case, threshold and engine. Use discovery/report verification; missing,
skipped or retried expected cases are not passes. Final CI and CodeQL must pass before handoff.

## Test secrets and receipts

No production credentials are needed for test fixtures. Keep temporary test secrets and
port overrides outside commits. Final receipts go in the PR description to avoid a new source
commit solely to record the preceding successful CI run.

## Editor invariants — 2026-10-30

Canonical CssRule models and exported CSS must remain unchanged by preview rendering.
In both engines, the stored-page and real-fixture startup checks each load the editor three
times, each in a fresh context, and assert that the median time from document start to the
`cms:startup:ready` mark is under 3,000 ms (`tools/e2e/cms-startup.spec.mjs`). The
synchronous editor spans that the startup checks report are browser instrumentation, not OS
or Edge CPU measurements.

Native priority uses the existing complete normalization policy only for targeted native
IDs, including inactive contexts. Current-frame measurements replace stale Desktop
snapshot dimensions.

A standalone native WebKit probe reproduced its physical text-size floor exactly.
The intrinsic regression therefore checks native-browser parity below that floor,
retaining owner font/width/alignment and the initial proportional assertion. The
mobile preservation counter checks actual editable IDs and excludes preview copies.

The preview regression covers the old-source failure in which duplicate global CSS changes
owner width and derived copies lose layer geometry and local references. Render-only
projection must preserve canonical ID model identity, direct declaration specificity,
anonymous layer identity and the same CSS during resize probes. Keep the existing CSS
validator: unsupported Raw syntax and reserved internal properties are not reasons to
broaden the admitted language.
