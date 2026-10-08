# CI architecture and verification

The definitive workflow is `.github/workflows/ci.yml`. Every pull request and every push to `main`
runs the complete graph. There are no path filters, scheduled substitutes, skipped suites, retries,
`continue-on-error` gates, or paid runner requirements.

The protected contexts keep their existing names: **Frontend and browser**, **Edge Functions**,
and **Database and integration**. The frontend context now also requires every CMS and production
startup shard. The database context requires both current-schema acceptance and historical rollout
compatibility. Gate executables reject missing, skipped, cancelled and failed dependencies.

## Modules and seams

The source preparation module (`.github/actions/ci-node`) owns frozen npm installation, the shared
format patch, source identity verification and Furl setup. Its interface is the checked-in composite
action; consumers receive the same tested source. The browser preparation adapter caches downloads
by the exact pinned Playwright version, OS, architecture and requested engines. System libraries are
always installed. Cache misses execute the same checks.

`@playwright/test` owns projects, browser reuse, isolated contexts/pages, fixture teardown, test
scheduling, timeouts, server readiness/shutdown, failure screenshots and traces. Product behavior
remains in native `.spec.mjs` bodies and domain checks. Controllable races, backend route fixtures,
CMS validation, real local Worker/Edge transport, HTTP-only cookies and database cleanup remain
explicit. Additional contexts model distinct customer sessions and motion settings; fixtures own
their final teardown.

The build module produces one production build for public/visual checks and one fixture build for
production CSP checks. Different environment contracts require those two builds. Consumers verify
both source identity and every artifact file hash. Worker dry-run packages the production build
without invoking a second frontend build. Artifacts use stable per-run names, so failed consumer
jobs can be re-run without rerunning successful producers.

Historical expand/contract checks own an isolated runner and database. They cannot alter the
current-schema integration runner. The former restorative reset disappears; both original rollout
stages still execute. Current acceptance retains Auth, Storage, Realtime, gateway, mail and Edge
runtime. Only Studio, metadata tooling and the pooler are omitted there.

## Preserved coverage

| Gate          | Native coverage / checks                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source        | Auto-format, format check, patch replay and exact source verification                                                                                                                                        |
| Static        | ESLint, TypeScript (including Playwright config), all unit tests, production dependency audit, CMS release stamp                                                                                             |
| Build         | Production compile/minification, real Worker dry-run, font license/artifact rejection, CSP fixture build                                                                                                     |
| Public/admin  | 73 cases: Chromium domain/race/session flows; privacy, CMS shell and delayed verification in all three engines; eight approved visual views; unchanged image CPU budget                                      |
| CMS           | 162 cases across Chromium/WebKit, including all 19 owner scenarios, populated content, projection, conflicts, responsive layout, resources, scenes, latency, workspace, accessibility and adversarial checks |
| Startup       | 12 cases against actual compiled routes under the existing production CSP policy                                                                                                                             |
| Edge          | Every entrypoint checked by Deno 2.9.5 with the frozen lock                                                                                                                                                  |
| Current DB    | All current migrations and pgTAP; serial adapter integration; actual Edge/Storage asset reuse; three real Worker/Edge/HTTPS customer engine flows                                                            |
| Historical DB | Original expand and contract migration compatibility checks                                                                                                                                                  |

Identical duplicate executions from the former standalone CMS workflows are consolidated. Owner
logos remain among the 19 owner cases; public CMS regression still runs in both engines; admin CMS
shell still runs in Chromium, Firefox and WebKit. Customer engines now publish independent real CMS
fixtures before their acceptance flows, avoiding shared state between native projects.

`admin-harness.tsx` and its controllable mutation, hydration and authentication gates are unchanged.
No production application behavior is redesigned. Existing screenshot files are retained byte for
byte. Native comparison uses the previous pixel threshold `0.1`, mismatch ratio `0.001`, device
scale 2 and existing platform-specific baseline directories. Missing snapshots fail and CI never
updates them. `pixelmatch` and `pngjs` are removed as direct dependencies; explicit capture/collage
and social-card utilities still use the pinned low-level `playwright` library.

## Execution and evidence

```bash
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e:cms
npm run test:e2e                # requires npm run build; public/admin/visual projects
npm run test:e2e:admin
VITE_SUPABASE_URL=https://admin-harness.invalid VITE_SUPABASE_ANON_KEY=e2e-public-anon-key \
  npm run build -- --outDir dist-startup --emptyOutDir
npm run test:e2e:startup
npm run test:e2e:customer       # requires dedicated local Supabase + documented Function env
```

Use native `--project`, `--grep`, and `--shard` options for scoped diagnosis. CI uses four CMS shards
per engine and two public shards. Each runner uses one browser worker so latency/CPU assertions do
not compete with another local test. Failure in one matrix member does not cancel unrelated members.

Each shard records its discovered plan before running. `verify-playwright-report.mjs` compares the
native JSON report to that plan: every expected case must execute exactly once and pass. Missing,
duplicate, skipped, flaky, interrupted, failed or retried outcomes fail the gate. A final source
identity check detects tracked changes by browser tests. JSON/HTML reports, timings, failure traces,
screenshots and domain evidence are retained as per-shard GitHub artifacts.

`tools/ci/test-*.mjs` exercises actual formatter replay/errors, the protected gate executable,
artifact corruption/staleness, native fixture failure/timeout/focused tests/empty selection, shard
completeness and report omission/failure/retry rejection. Python Furl safety checks remain mandatory.
The browser matrix and screenshot tolerance are part of these acceptance contracts, not tunable
shortcuts to passing CI.

## Performance evidence and rollout status

Baseline docs PR #82 at `6ea74a0bac5a631a4ca1334613bba69b71de2161`:
[CI run 37750744863](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/37750744863).
It completed successfully in **18m15s** from run creation; the serial CMS shell job took **15m37s**.
Frontend/browser took 6m06s and database/integration took 7m57s. Queue time is included in the
workflow duration and must be reported separately when comparing execution improvements.

Local verification passed 866 unit tests, all 13 frozen Edge entrypoints, 10 CI orchestration contracts, 17 real Furl safety checks, lint/types, both production builds, 12 CSP cases and all 8 approved visual views. Targeted native admin/CMS cases also passed. A semantic AST comparison retained every original CMS domain assertion; four result-aggregation gates and one engine-selection guard now belong to the native runner/report checks. Full optimized GitHub
runs, cold-cache execution, final-head speed evidence, merge, main verification and rebasing PRs
#83/#84 are still pending. This document does not claim those outcomes before live evidence exists.

Before merge, require successful complete native reports, all protected contexts, cold and warm
execution, and a material reduction from the successful baseline. Then merge this docs PR, verify
main, rebase the two remaining PRs onto that exact main commit, and verify every resulting PR head.
