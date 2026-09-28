# CMS context latency investigation

## Scope and source

Owner request: restore/revert, language, theme and Home device switches, followed
by a broader review of CMS interactions. Preserve the UI, editing/booking behavior,
content validation, undo/redo and protected components. No unrelated refactor,
production content writes, deployment, timeout increases or skipped tests.
Branch: `latency-fixes`; draft PR: #80. Baseline product tree: merged main `f84abc4`.

Evidence is retained outside tracked source in
`/Users/k/dev/barber/cms-latency-round2/`. `public-presentation.json` is a read-only
copy of public revision 42, with storage URLs rewritten to the isolated fixture.
The same Mac/Chromium development build and fixture APIs are used for before/after
measurements. Timings are observed samples, not production percentiles or an SLA.

## Coverage

- [x] 70 baseline/repeated operations: five core pages; both languages, themes and
      device modes; editing, undo, redo, revert; zoom, fit, comparison; inspector tabs;
      business, email, theme, resources and history workspaces.
- [x] 48 additional operations: metadata fields, all booking stages, palette/font
      controls, email templates, resource filters/search/selection/metadata, history
      inspection/restore, locked preview, and creating/switching an independent page.
- [x] Repeat the core context/restore/workspace probe with the larger published
      presentation (49 actions), not just the smaller generated fixture.
- [x] Review the implementation independently and verify demonstrated findings.
- [x] Add regressions to hosted Chromium/WebKit suites and the production CSP gate.
- [ ] Final exact-head hosted CI gate: all four workflows must finish successfully;
      pending or canceled runs never establish acceptance. Record the outcome in PR #80.

## Reproduced causes and implemented changes

1. GrapesJS 0.23.6 still serializes its project for autosave with a disabled storage
   destination. Disable its autosave explicitly; the existing CMS backup remains.
2. `getCss({keepUnusedStyles:true})` scans every component to collect selector usage
   which this configuration does not use. Read the same complete CSS generator
   without that component scan; preserve unused/media rules and output equality.
3. Clean switches flush unchanged HTML/CSS, and hidden workspaces keep updating
   their editor. Track synchronous `updateBefore` events and pause hidden/locked
   canvas work without dropping immediate edit-then-switch changes.
4. Home device switches and booking stage switches reconstruct existing trees.
   Move their canonical owner/stage models instead. Preserve selection, scroll,
   resize state, protected nodes and correct preview visibility.
5. Revert/history reruns source repair for complete snapshots. Repair only missing
   or legacy layouts, retaining the original empty-publication fallback.
6. Language/theme switches rebuild equivalent native models and repeatedly parse
   unchanged content. Plan identity-checked updates before mutation, retain the
   normal structural fallback, and cache at most four exact compiled contexts.
7. Home/About composition repeats identical source CSS, and unchanged fold state
   repeatedly writes styles/forces layout. Remove only equivalent duplicate rules
   without disturbing cascade layers; skip unchanged preview-state writes.
8. Resource selection validates the entire draft once per asset on the UI thread.
   Build one validated placement index in a bundled worker per draft. Validate
   HTML once per language and identical CSS once per scan. Pending, stale or
   malformed scans fail closed; destructive actions still recheck a newer draft.
9. Full imports insert compiled CSS rules into the live frame individually.
   Reset the existing rule collection once, preserving the import ordering and
   GrapesJS's collection/cache listeners. The authored-page regression observed
   161 live additions before, zero after.
10. Independent pages unnecessarily recompile visited contexts and invalidate
    their canvas when unrelated page metadata changes. Include them in the same
    bounded cache and key their authored canvas by their own path/content/mode.
    Keep full structural import for these pages; do not broaden the native model
    reconciler to page shapes it does not already support.

## Reproductions and review

`full-final-audit.json` at the batch-import revision records fixture Home EN/SV
at 245/152 ms (baseline 1260/1312), dark/light at 202/125 ms (1031/908), and mobile/
desktop at 74/69 ms (694/640). The two revert samples are 181/184 ms (1493/1407).
The published-shape first language/theme switches remain heavier than the small
fixture; `public-final-audit.json` records the complete samples, not only the best.

`continued-before-audit.json` resource selections took 602/497/401/377 ms with
572/467/377/363 ms main-thread tasks. The repeated indexed path in
`continued-final-audit.json` took 30/22/27/28 ms with no recorded long task.
Initial locked preview and history inspection still include validation/network
and runtime initialization; those waits were measured but not removed by bypassing
validation or replaced with a claim of zero latency.

The independent read-only review of `9bc2892` found one important correctness bug:
GrapesJS images export the model `src`, not only `attributes.src`. The reuse path
could therefore restore an image visually but export its old source on the next
edit. A focused regression failed with `/old.png` instead of `/new.png`; the fix
synchronizes the image model and keeps missing-source cases on the normal import.
The same test then passed. The follow-up read-only review of `9bc2892..35061d9`
reported no other demonstrated important correctness regressions.

Local targeted verification observed red then green for the image source,
resource index, compiled-rule batching and independent-context cache. The worker
browser tests cover pending checks, a stale unused result after editing, exact
placements, malformed unrelated CSS and reuse across selected files. Both engines
passed those targeted checks. The production-startup scenario additionally proves
the bundled worker completes under the real production CSP without content writes.
Full unit, browser, database and integration suites remain hosted CI gates.
