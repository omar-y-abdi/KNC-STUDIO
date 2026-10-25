# CI architecture and verification

The definitive workflow is `.github/workflows/ci.yml`. Every pull request and every push to `main`
runs all jobs. Pull requests run the full Chromium CMS matrix and select the whole `cms-owner`,
`cms-mobile`, `cms-new-page-mobile` and `cms-barber-marquee` files for WebKit. Pushes to `main` and
manual runs use the full WebKit CMS matrix. The public group still runs Chromium, Firefox and
WebKit on both events. There are no path filters, scheduled substitutes, retries,
`continue-on-error` gates, or paid runner requirements.

The protected contexts keep their existing names: **Frontend and browser**, **Edge Functions**,
and **Database and integration**. The frontend context now also requires every CMS and production
startup shard selected for the event. The database context requires both current-schema acceptance
and historical rollout compatibility. Gate executables reject missing, skipped, cancelled and failed
dependencies.

## Modules and seams

The source preparation module (`.github/actions/ci-node`) owns frozen npm installation, replay of the
shared format patch and source identity verification. Container preparation checks UID 1001 and
write access before caches, artifact downloads and `npm ci`; npm cache paths come from shell
variables inside the container. Furl setup and regression tests belong to the quality job. Workflow
commands use plain Bash. The format job produces a patch that consumers replay, so formatting does
not block pushes.

The `public-browsers`, `cms` and `startup` jobs use
`mcr.microsoft.com/playwright:v1.61.1-noble` with UID 1001 and `--ipc=host`. The image supplies browsers
and their system libraries; these jobs still run `npm ci` but do not install browsers. Bump the
image tag with `playwright` and `@playwright/test` in the same Dependabot PR. The `database-current`
job stays on the host runner for Docker and uses `.github/actions/ci-browsers` to cache browser
binaries by pinned Playwright version, OS, architecture and engines. That adapter installs system
libraries even on a cache hit and uses Ubuntu's official HTTPS mirrors.

The Edge job runs from `supabase/functions`, using its own `deno.json` and frozen `deno.lock` with
`nodeModulesDir: none`. Deno resolves npm packages from its cache using locked versions and
integrities, independently of the root npm tree. Every entrypoint must pass and an empty selection
fails. Supabase serve/deploy instead resolve bare imports through each function's own `deno.json`;
the Edge contract checks every reachable local module, including `shared/`, against that map.

`@playwright/test` owns projects, browser reuse, isolated contexts/pages, fixture teardown, test
scheduling, timeouts, server readiness/shutdown, failure screenshots and traces. Product behavior
remains in native `.spec.mjs` bodies and domain checks. Controllable races, backend route fixtures,
CMS validation, real local Worker/Edge transport, HTTP-only cookies and database cleanup remain
explicit. Additional contexts model distinct customer sessions and motion settings; fixtures own
their final teardown.

The build module produces one production build for public/visual checks and one fixture build for
production CSP checks. Different environment contracts require those two builds. Consumers verify
both source identity and every artifact file hash. Source identity combines the commit with a Git
tree of tracked working content, using a temporary index; it does not hash patch text or include
untracked downloads such as `.ci-source` and `.ci-build`. Worker dry-run packages the production build
without invoking a second frontend build. Artifacts use stable per-run names, so failed consumer
jobs can be re-run without rerunning successful producers.

Historical expand/contract checks own an isolated runner and database. They cannot alter the
current-schema integration runner. The former restorative reset disappears; both original rollout
stages still execute. Current acceptance retains Auth, Storage, Realtime, gateway, mail and Edge
runtime. Only Studio, metadata tooling and the pooler are omitted there.

## Preserved coverage

| Gate          | Native coverage / checks                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source        | Auto-format, format check, patch replay and exact source verification                                                                                     |
| Static        | ESLint, TypeScript (including Playwright config), all unit tests, production dependency audit, CMS release stamp                                          |
| Build         | Production compile/minification, real Worker dry-run, font license/artifact rejection, CSP fixture build                                                  |
| Public/admin  | Chromium domain/race/session flows; privacy, CMS shell and delayed verification in all three engines; approved visual views and existing image CPU budget |
| CMS           | Full Chromium matrix; owner/mobile WebKit selection on PRs and full WebKit matrix on main pushes and manual runs, as listed above                         |
| Startup       | Chromium and WebKit against actual compiled routes under the existing production CSP policy                                                               |
| Edge          | Every entrypoint checked by Deno 2.9.5 with the frozen lock                                                                                               |
| Current DB    | All current migrations and pgTAP; serial adapter integration; actual Edge/Storage asset reuse; three real Worker/Edge/HTTPS customer engine flows         |
| Historical DB | Original expand and contract migration compatibility checks                                                                                               |

Identical duplicate executions from the former standalone CMS workflows are consolidated. Owner
logos remain in the owner cases; public CMS regression still runs in both engines; admin CMS
shell still runs in Chromium, Firefox and WebKit. Customer engines publish independent real CMS
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
VITE_SUPABASE_URL=https://admin-harness.invalid VITE_SUPABASE_ANON_KEY=e2e-public-anon-key \
  npm run build -- --outDir dist-startup --emptyOutDir   # harness build: never embeds production
E2E_PUBLIC_DIST=dist-startup npm run test:e2e   # public/admin/visual projects
E2E_PUBLIC_DIST=dist-startup npm run test:e2e:admin
npm run test:e2e:startup
npm run test:e2e:customer       # requires dedicated local Supabase + documented Function env
```

Use native `--project`, `--grep`, and `--shard` options for scoped diagnosis. CI uses four CMS shards
per engine and two public shards. Each runner uses one browser worker so latency/CPU assertions do
not compete with another local test. Failure in one matrix member does not cancel unrelated members.

Several worktrees can run Playwright at the same time if each one has its own `E2E_PORT_OFFSET`, for
example `E2E_PORT_OFFSET=100 npm run test:e2e:cms`. The harness dev server, the public preview and
the startup preview then listen on 4188, 4173 and 4189 plus the offset (an integer from 0 to 1000,
default 0; CI sets none and is unchanged). Keep concurrent offsets at least 20 apart, such as 0, 100
and 200: offsets 1, 15 or 16 apart make one run's port another run's port. Locally
`reuseExistingServer` is on, so two runs with the same offset do not fail; the second silently tests
the first worktree's code. `BASE_URL`, `PUBLIC_BASE_URL` and `CMS_STARTUP_URL` still override the
origins the tests visit. Vite's dependency cache lives in `.vite-cache` inside each worktree because
every worktree's `node_modules` is one shared install. The customer group keeps its own ports and
the shared local Supabase stack, so it cannot run in parallel.

Each shard records its discovered plan before running. `verify-playwright-report.mjs` compares the
native JSON report to that plan: every expected case must execute exactly once and pass. Missing,
duplicate, skipped, flaky, interrupted, failed or retried outcomes fail the gate. A final source
identity check detects tracked changes by browser tests. JSON/HTML reports, timings, failure traces,
screenshots and domain evidence are retained as per-shard GitHub artifacts. Uploads naming a hidden
`.ci-*` plan explicitly enable `include-hidden-files` so the discovered plan is retained too.

`tools/ci/test-*.mjs` exercises actual formatter replay/errors, the protected gate executable,
artifact corruption/staleness, native fixture failure/timeout/focused tests/empty selection, shard
completeness and report omission/failure/retry rejection. Python Furl safety checks remain mandatory.
The browser matrix and screenshot tolerance are part of these acceptance contracts, not tunable
shortcuts to passing CI.

## Historical performance and acceptance evidence

The following measurements describe the earlier native-runner migration, before F2's containers
and event-specific WebKit selection. They are historical receipts, not measurements of this workflow.

Baseline docs PR #82 at `6ea74a0bac5a631a4ca1334613bba69b71de2161`:
[CI run 37750744863](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/37750744863).
It completed successfully in **18m15s** from run creation; the serial CMS shell job took **15m37s**.
Frontend/browser took 6m06s and database/integration took 7m57s. Queue time is included in the
workflow duration and must be reported separately when comparing execution improvements.

The complete migrated graph passed both cache modes at `89a7f6052d9dbcda4136cd0c514018df99474fb6`:
[warm run 37764022991](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/37764022991) and
[cold run 37764940852](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/37764940852).
The cold run explicitly disabled npm and browser cache restoration. The warm PR merge tree and
cold branch tree matched exactly (`314d18fc518cc06a29ba70b00b740c7008dd3edd`).

| Measurement                   | Previous successful graph | Migrated warm   | Migrated cold   |
| ----------------------------- | ------------------------- | --------------- | --------------- |
| Complete workflow wall time   | 18m15s                    | 7m46s           | 9m09s           |
| Initial runner queue          | 1m07s                     | 3s              | 4s              |
| Wall time after initial queue | 17m08s                    | 7m43s           | 9m05s           |
| Longest CMS job               | 15m37s                    | 6m54s           | 6m54s           |
| Aggregate job execution       | 53.4 runner-min           | 62.7 runner-min | 65.8 runner-min |

Wall time fell 57% warm and 50% cold; after subtracting initial queue, reductions were 55% and
47%. Aggregate execution is the sum of job start-to-finish times, not rounded billed minutes.
The previous total includes the replaced [startup](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/37750744870),
[unified resource](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/37750744880), and
[workspace](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/37750744883) workflows. Parallel
acceptance and independent customer-engine publication use more aggregate runner time; this change
optimizes feedback time and isolation. Browser preparation in both warm public shards took 59–61s
after switching package mirrors, compared with the earlier 15-minute interrupted download.

All 13 downloaded browser reports in each measured run passed whole-matrix verification:
**250 cases**, each exactly once, with no skips/retries/omissions and one source identity per run.
Coverage was 81 CMS cases per Chromium/WebKit engine, 57 Chromium public/admin/visual cases,
eight shared public cases per Firefox/WebKit engine, six CSP cases per Chromium/WebKit engine,
and one complete real customer flow per Chromium/Firefox/WebKit engine. Every other quality,
current-schema and historical-migration gate also passed.

Local verification passed 866 unit tests, all 13 frozen Edge entrypoints, 10 CI orchestration
contracts, 17 real Furl safety checks, lint/types, both production builds, 12 CSP cases and all eight
approved visual views. The reduced-motion browser fixtures and exact Calendar timer checks were
reproduced failing before correction and passed afterward. Semantic AST inspection retained the
original domain assertion expressions across all 38 old E2E modules. Eight generic aggregation,
shutdown and engine-selection assertions are now represented by native failure handling/report
verification. Owner/conflict cases preserve diagnostics and propagate the original exception.
E2E/visual source is 353 lines smaller; the earlier 1,200-line estimate did not justify removing
domain scenarios or controllable race gates.

Keep complete reports, all protected contexts, cold/warm execution and material performance
improvement as merge requirements. Verify the final commit, then main and every rebased PR head.
[PR #82](https://github.com/omar-y-abdi/KNC-STUDIO/pull/82) records final-head, merge/main and
follow-on PR receipts for this rollout.
