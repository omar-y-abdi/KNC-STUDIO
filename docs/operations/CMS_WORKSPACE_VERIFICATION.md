# CMS workspace verification

The workspace refines the existing native-site CMS rather than replacing the public
site. It keeps publication in the persistent header, isolates mobile drawers, and
preserves editor state while visiting resources, business details, email, history
and site-wide styling.

## Reproducible browser gates

`CMS workspace (chromium)` and `CMS workspace (webkit)` run on pull requests and
main using the same formatting patch and Furl wrapper as the other CI jobs.
Each engine executes:

- `tools/e2e/cms-workspace.mjs`: persistent publication, bounded toolbar, initial
  device, search-empty feedback, drawer focus/inert cleanup and keyboard tabs.
- `tools/e2e/cms-preview-state.mjs`: deliberately delayed native rendering,
  loading/readiness, stale-context isolation, failure, retry and denied writes.
- `tools/e2e/cms-workspace-views.mjs`: workspace destinations, dialogs, form
  errors, scrolling, keyboard interaction, axe checks and screenshots.
- `tools/e2e/cms-touch.mjs`: touch emulation in portrait and short landscape,
  wide desktop, delayed opening of the theme preview, visible-frame bounds
  and publication reachability.

Set `BASE_URL`, `CMS_BROWSER` and `CMS_EVIDENCE_DIR` to target a running isolated
fixture server, select an engine and choose an output directory. The views suite
also requires `AXE_PATH` pointing to `axe.min.js`. CI installs the audit tool outside
the application; it is not a runtime dependency.

All scenarios use the repository's injected read-only/native test ports. They do
not require customer credentials, make real bookings, or publish production
content. Touch emulation is not physical-device certification. Existing native,
owner, scene, populated-data, conflict and Worker/Edge gates remain independent.

## Evidence and visual review

The per-engine `cms-workspace-*` artifact includes the source commit and formatting
patch, full and Furl-compressed logs, exit codes, structured assertions, and PNGs.
Screenshots with visible live previews wait for an actual matching native readiness
ID, not just iframe navigation. All scripts fail when an acceptance check fails;
an artifact alone is not a passing result.

Review the complete surface/scroll sequence, not just the first editor screenshot.
Check narrow drawers, fields at the bottom of workspaces, populated and empty
resources, confirmation/errors, dark mode, keyboard focus and preview loading/error
states. Automated accessibility and layout assertions complement visual review;
they do not prove that every possible document or physical device is covered.

## Regression boundaries

`tests/unit/cmsResourceUsage.test.ts` ensures large valid native pages can be
inspected without relaxing publication's markup limits, route checks or URL
validation. It also checks that resource discovery does not mutate the draft.

Native motion/readiness state remains outside the saved editor model. Preview
loading, retry and navigation must never perform operational writes. A failed
source preview remains an explicit recoverable error rather than a blank canvas.
