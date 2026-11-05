# Module boundaries and affected verification — 2026-11-05

The implementation started from the repaired mobile branch at `a719093`. PR #173 subsequently
merged as `b8b7d00`; its tree matches that starting point. This change therefore targets `main`.
The frozen implementation reviewed and independently tested below is `002f9db`.

## Delivered boundaries

Actual implementations reside in four application workspaces: public website/customer flows,
staff administration, Studio and backend. Two named contract workspaces own authored content and
backend wire formats. The root still composes the deployment; separate deployments are not part
of this change. See `docs/architecture/MODULE_BOUNDARIES.md`, `tools/modules/README.md` and `docs/CI.md` for ownership,
interfaces, commands and selection rules.

Public preview owns its renderer and read-only runtime. Studio consumes its lightweight protocol,
while root composition loads the runtime. Consumer-specific interface checks prevent Studio from
regaining direct access to the public App or preview implementation. Staff retains the existing
protected session/client. Backend deployment names, SQL and authorization behavior are preserved.

## Independent verification

These commands ran in a separate clean checkout with its own frozen npm installation. Production
build environment values were loaded without printing credentials.

| Check                                         | Observed result                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Full unit suite, `npm test -- --maxWorkers=2` | 174 files, 2,313 tests passed at `002f9db`                                                        |
| Module and CI orchestration suites            | 54 passed, zero failures/skips/cancellations at `002f9db`                                         |
| Python Furl regression suite                  | 17 passed                                                                                         |
| ESLint and TypeScript                         | Passed on the completed combined tree                                                             |
| Production build and bundle budget            | Passed after the route recovery fix: 111.6 kB gzip in 16 boot files; existing limit 115 kB        |
| Worker packaging                              | Wrangler `deploy --dry-run` passed; this is packaging evidence, not deployment                    |
| Backend workspace typecheck                   | Root Worker/frontend TypeScript and all 14 Deno 2.9.5 entrypoints passed with frozen dependencies |
| Stored native-ID coverage                     | The compiled-site contract requiring every stored source ID to exist with its tag passed          |

An earlier independent unit run at `c2275eb` had one existing 5-second Contact test timeout while
the production build ran concurrently. The final run above used the unchanged timeout and no
competing build; all cases passed. This is not evidence that arbitrary concurrent local workloads
meet the timing budget.

The extraction author also compared baseline/candidate Worker responses using the same stored
presentation and shell. Status, headers and body bytes matched for `/`, `/about`, `/booking`,
`/my-bookings`, `/privacy`, `/terms` and `/cms-public/source`. The fixture lacked Contact, so that
comparison does not establish `/contact` byte parity. The existing core-page preservation browser
case passed separately. No visual baselines or screenshot tolerances changed in this refactor.

## Review findings and regressions

Independent review found and closed four concrete defects before handoff:

1. Moving the lazy CMS route outside its previous error boundary removed the reload UI after a
   failed route-chunk request. The corrected outer boundary passed four independently executed
   Chromium/WebKit cases covering both slash forms, failed first fetch, reload and the login gate.
2. A declared public browser spec could be absent from Playwright's fixed project lists and still
   yield a successful discovered/executed report. Always-on CI now compares native file discovery
   with declared ownership for all four browser groups and native unit discovery. Hostile tests
   cover a missing public spec, an empty CMS spec and a mislabeled unit with another runnable unit.
3. Unknown browser/harness imports were discarded from the narrow component-consumer guard.
   Such uncertainty now requires full verification, including when the unknown consumer already
   exists in the base commit and only the component changes afterward. Unknown unit filesystem
   dependencies remain recorded and always selected.
4. Stylesheets were not parsed while their changes could authorize reduced verification. CSS
   imports/resources now obey package boundaries. Tests cover private paths, escaped identifiers,
   encoded paths, root URLs and image-set strings. CSS, HTML and other unmodeled source behavior
   select full verification.

The final focused independent re-review passed 26 module/native-runner checks and replayed the
original public-inventory, unknown-consumer and private-CSS counterexamples successfully.

## Controlled affected-plan proof

In the independent checkout, a temporary comment was added only to
`modules/studio/src/DeliveryStatus.tsx`. It is a verification probe, not a product change in this PR.
The real planner used the exact checked-out base/head and modified tracked tree; subsequent
commands consumed its verified plan through the same CI bridge.

The plan selected 74 of 174 unit files, four CMS specs, two public/admin specs and production
startup. It selected one CMS shard per engine and one public shard. It explicitly omitted Edge,
current database/customer acceptance and historical rollout. Shared format, SQL, CSS, unknown
input and invalid-context fixtures still select the broad required consumers or full verification.

The selected native Vitest command passed all 74 files and 1,284 tests. The same verified plan then
ran the actual native browser commands:

| Selected group                                                               | Executed result |
| ---------------------------------------------------------------------------- | --------------- |
| CMS delivery/owner/workspace, Chromium and WebKit                            | 66 passed       |
| Public/admin delivery and shell, configured Chromium/Firefox/WebKit projects | 70 passed       |
| Compiled production startup and CSP, Chromium and WebKit                     | 14 passed       |

All 150 cases passed exact discovery/execution accounting, with no skips, retries or missing
outcomes. Source-tree and plan rederivation checks passed after every group. Public/startup used
one source-verified build embedding only the fake backend origin. These are local execution
receipts, not a hosted affected-PR timing benchmark.

The component is deliberately the audited delivery panel. `WorkspaceView` remains broad because
resource engineering/workflow/usage/adversarial tests also consume it. Most public/backend/contract
changes remain broad because persisted documents, preview capture, SQL and runtime interfaces cross
those boundaries. This first partition does not claim minimal selection for every possible file.

## CodeQL follow-up

Latest main `b8b7d00` was merged as `44749a0` without conflicts or source changes.
CodeQL then reported nine polynomial regular-expression findings in route and shell metadata
handling. Commits `7ed1c77` and `56f1546` replace those expressions with bounded scans while
preserving the existing metadata matching and response bytes. No CodeQL suppressions were added.

Independent review at `56f1546` passed 140 affected tests and 600,000 fresh differential cases
against the previous metadata matching behavior, including malformed input. Actual private-renderer
regressions cover repeated metadata markers and a leading match followed by a large uppercase body.
The latter failed before the follow-up at 736 ms against its 250 ms bound, then passed at 13 ms.
These are local regression timings, not production Worker CPU measurements.

The final separate-checkout run at `56f1546` passed all 174 unit files and 2,339 tests. The production
build, unchanged bundle gate and Worker dry-run also passed. Public boot now measures 111.7 kB gzip
in 16 files against the same 115 kB limit. The earlier affected-plan and browser receipts above
remain explicitly tied to their original checkpoint. Hosted CodeQL acceptance must be checked on
the pushed follow-up commit; local review does not substitute for that result.

## Release and runtime limits

Source relocation changes the CMS release digest. Keep the existing backend-before-frontend
compatibility procedure in `docs/operations/CMS_RELEASE.md`; a matching source stamp is not proof
that production has been updated. No database migration was added by the module extraction.
Current-schema integration, historical rollout and the full browser matrix remain required for
the refactor PR because manifests, source layout and CI configuration changed.

This report qualifies modularization at the checkpoints named above. Mobile customer fixes are
now included in the same PR and qualified separately in
`docs/qa/2026-11-05-combined-pr174.md` and its linked reports. Module verification alone does not
establish those mobile behaviors.
