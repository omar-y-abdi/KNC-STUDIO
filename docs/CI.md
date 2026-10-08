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
always installed. It prioritizes Ubuntu's official HTTPS mirrors instead of the hosted image's
Azure HTTP mirror, which stalled the first migrated public shard for 15 minutes. Repository
signatures and package requirements remain enforced. Cache misses execute the same checks.

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

## Measured performance and acceptance evidence

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
