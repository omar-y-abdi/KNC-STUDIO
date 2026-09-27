# CMS interaction latency implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task.

**Goal:** Remove reproduced CMS delays after editing, navigation and resource assignment.
**Architecture:** Keep the existing editor, data model, protection rules and user workflows.
Use measured call counts and CPU profiles to eliminate repeated work at the source.
**Tech stack:** Preact, GrapesJS 0.23.6, TypeScript, Supabase.
**Spec:** Owner request of 2026-09-27: latency only; incremental pushes; testing in PR CI.

## Constraints

Work in the supplied checkout/branch. Do not change unrelated files, publish owner
content, deploy the backend or mutate production data. Profile with isolated browser
fixtures; run regression suites in hosted CI. Do not raise timeouts to hide stalls.

## Reproduction and evidence

Starting product tree: `cd959e2` (identical to merged main `6e61499`).
The original PR #78 is merged, so a new draft PR is required.
`../cms-latency-evidence/profile.mjs` drives the real editor against fixture APIs.
CPU profile and metrics are outside tracked source; no credentials or owner data.
Local Chromium: 218 components, 424 CSS rules, HTML 115536 bytes, CSS 49052 bytes.
Text edits caused 340–360 ms long tasks. Booking switch: 2215 ms long task;
return Home: 1473 ms. These are development-build diagnostic measurements,
not production acceptance or cross-machine timing guarantees.
The profile attributes 222 ms self CPU to repeated draft dirty serialization,
1258 ms inclusive to export across edits, and 860 ms to import policy configuration.
Live read-only logs also show CMS requests up to 5518 ms; not yet a proven DB bug.

## Review focus

Undo/redo and in-flight publication must retain exact dirty semantics.
Page/device/theme changes must preserve layout and protected native components.
Text-only edits must not lose styles or resize synchronization.
Upload completion must retain placement identity and remain one undo transaction.
No change may treat canceled/pending CI as passing.

## Tasks

- [ ] Lock repeated dirty-read cost with a regression, observe red CI, cache only
      immutable snapshot comparisons in `src/admin/cms/draft.ts`; retain existing draft tests.
- [ ] Minimize the import/export hot paths with the browser probe before fixing.
      Add operation-count regressions to the existing CMS browser CI workflow.
      Change only measured expensive paths in editor/native helpers.
- [ ] Measure the full resource assignment/upload path, distinguish API time from
      local capture work, and fix only a confirmed repeated-work cause with coverage.
- [ ] Repeat the original probe, inspect exact-head CI after incremental pushes,
      review the complete latency-only diff and record remaining limits honestly.

## Ledger

Baseline profile reproduced browser stalls without production writes.
Merged origin/main into the supplied branch without source changes so the new PR
contains only this latency work (previous work was squash-merged).
