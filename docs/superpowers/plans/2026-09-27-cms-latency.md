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

- [x] Lock repeated dirty-read cost with a regression, observe red CI, cache only
      immutable snapshot comparisons in `src/admin/cms/draft.ts`; retain existing draft tests.
- [x] Minimize the import/export hot paths with the browser probe before fixing.
      Add operation-count regressions to the existing CMS browser CI workflow.
      Change only measured expensive paths in editor/native helpers.
- [x] Measure the full resource assignment/upload path, distinguish API time from
      local capture work, and fix only a confirmed repeated-work cause with coverage.
- [ ] Repeat the original probe, inspect exact-head CI after incremental pushes,
      review the complete latency-only diff and record remaining limits honestly.

## Ledger

Baseline profile reproduced browser stalls without production writes.
Merged origin/main into the supplied branch without source changes so the new PR
contains only this latency work (previous work was squash-merged).

### Implemented latency fixes and measured evidence

- `CmsDraft.dirty`: compare a snapshot pair once, not on every workspace render.
  Red CI `36338257111` observed 40 serializations for 20 unchanged reads; the
  regression allows two. Undo/redo and base replacement remain covered.
- Native import policy: apply SVG/layer metadata silently as a batch, then render
  the existing Layers view once when visible. A current layer previously rendered
  nine times per switch; the batched visible view renders twice.
- Hidden Layers: do not create the second DOM tree until its tab is opened;
  dispose the view/listeners when closed. Hidden redraw count fell from nine to
  zero. Chromium and WebKit CI cover closing/reopening the native UI twice and
  preserving SVG layer availability.
- Native CSS conversion: cache identical baseline/value normalization within one
  conversion and reuse one reset scratch declaration. The 100-node reproduction
  dropped from 301 scratch elements to two, with identical CSS/text output.
  A valid declaration followed by an invalid one is explicitly covered.
- Multi-file uploads: store each successful file immediately, but assign the
  successful subset in one draft transaction and refresh once. A later upload
  failure still retains/assigns earlier successes; remaining files are not sent.
  Red CI `36339534961` reproduced two transactions for two files in both engines.
  The full local Studio three-file probe measured 24 -> 8 source captures and
  11014 -> 3772 ms with fixture upload responses. Network transfer and image
  encoding are mocked, so these are not production upload SLA measurements.

### Verification and limits

At `a959bb3`, both engines passed every unified-resource and workspace suite;
production startup passed. The main CI frontend job (including unit tests,
production build and browser smoke) and Edge Functions passed; later pushes
canceled the remaining database and CMS-shell jobs, so those are not a green gate.
The hosted interaction probe recorded Booking/Home switches at 665/534 ms in
Chromium and 1236/632 ms in WebKit. Do not compare these against Mac wall-clock
measurements as a before/after speedup: environments differ.

At `53bcc44`, both engines passed the batch transaction and partial-upload
assertions; the new test subsequently hit its obsolete final no-error expectation
(after intentionally injecting an error). This expectation is corrected here,
with the original no-error assertion preserved before fault injection. CI also
caught an overly narrow extracted upload-helper input type; replacement now uses
existing typed `resourceDestination` rather than the display-label helper.

A Chromium hierarchical-resize assertion failed once on `f58ffb4`; the same
product code passed the preceding run, WebKit, and both engines on `53bcc44`.
No tolerance or product geometry code was changed to force a pass.

Supabase inspection was read-only. State RPC statistics did not establish a
DB cause for the reproduced browser stalls. Slow historical-retention queries
are outside successful CMS uploads and were deliberately left unchanged.
There is no production deployment, owner draft mutation, timeout increase or
claim that all production interactions now meet an unmeasured latency target.
Final-head CI must be checked on PR #79 before any merge decision.
