# WIP recovery after PR #91 — 2026-10-28

## Baseline and authorization

The owner merged PR #91 as main `93ff32985052a42b9215db210ad5e6951aad5a65`.
PR #90 is closed. `/Users/k/dev/barber/project` is now on local main at that commit.
Old branches/worktrees and unrelated untracked files remain preserved.

The owner resumes all remaining implementation with four GPT-6.1 Sol agents at max
reasoning. The coordinator owns review, integration and ALL test execution. Authors
run no tests/builds/typechecks/servers/database stacks. Tests run serially with one
worker where supported. This supersedes the earlier pause, medium routing and ban
on coordinator local tests. Production deployment, migration and CMS publication
remain outside this PR task. Deliver one open PR against main, then shut down only
this session's Colima profile and go idle for owner review.

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
   Four agents total; tool capacity permits three running subagents simultaneously.

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

The coordinator runs local checks serially: static/unit/build gates and focused browser
regressions for demonstrated failures, plus local pgTAP, adapter integration and actual
Edge/Storage/customer journeys. Full configured CMS Chromium/WebKit, public/admin/visual,
startup, Edge and historical database coverage runs in GitHub on the final pushed head;
these suites need not be duplicated locally without a new risk or failure. Keep every
configured case, threshold and engine. Use discovery/report verification; missing, skipped
or retried expected cases are not passes. Final CI and CodeQL must pass before handoff.
One background watcher per push; inspect failed logs, avoid manual status polling.

## Environment ownership

Other session's `default` Colima profile was running at discovery; never stop or mutate it.
Our profile is `knc-wip-20261028`, started with --activate=false, 2 CPUs/4 GiB.
Pin DOCKER_HOST per command to its socket; do not change global Docker context.
Use isolated Supabase host ports and E2E_PORT_OFFSET after checking availability.
Dependencies are private under `/Users/k/dev/barber/wt/.wip-deps-20261028`.
No production credentials are needed for test fixtures. Keep temporary test secrets and
port overrides outside commits. Stop our services/profile at final handoff, including
failure/blocked handoff. Final receipts go in the PR description to avoid a new source
commit solely to record the preceding successful CI run.
