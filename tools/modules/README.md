# Module boundaries and affected verification

`boundaries.mjs` parses production TypeScript/JavaScript with the installed TypeScript parser. It resolves static imports, re-exports, import types, literal dynamic imports, CommonJS dependency forms, and `new URL(..., import.meta.url)` assets/workers. Comments and source strings are not imports. Nonliteral imports and unsupported `import.meta` dependency operations prevent affected verification. Local production dependencies must resolve.

The six workspaces have explicit file exports and declared dependency directions. Browser code crosses packages through bare exports; Studio cannot import the public app or source-preview implementation. Public interfaces also have consumer-specific allowlists. Deno functions and portable contracts may retain explicit relative `.ts` imports to exact exported source files in declared packages. Remote Deno imports remain the responsibility of the real Deno CI gate; import-map and lockfile changes select full verification. Test harnesses may inspect private implementation and are recorded separately from production edges.

Owned and public stylesheets are parsed with the installed `css-tree` parser. CSS imports and resource URLs obey package boundaries, including escaped identifiers/function names, encoded paths, root URLs and string forms in `image-set`. Local styles and public fonts/assets resolve to real files; relative or root-URL access to another package's private styles is rejected. Opaque remote/data CSS dependencies, malformed encodings and parser fallback syntax are rejected rather than treated as complete edges. CSS/HTML and other unmodeled module source formats select full verification because their global/runtime effects are not established by the import graph.

## Plans and trust

Generate the plan **after formatting**. Supply exact Git commit SHAs from trusted workflow context. Store artifacts outside the checkout or in the exact ignored CI artifact directories.

```sh
node tools/modules/impact.mjs create --base "$CI_BASE_SHA" --head "$CI_HEAD_SHA" --event "$CI_EVENT_NAME" --file "$RUNNER_TEMP/impact.json"
node tools/modules/impact.mjs verify --base "$CI_BASE_SHA" --head "$CI_HEAD_SHA" --event "$CI_EVENT_NAME" --file "$RUNNER_TEMP/impact.json"
node tools/modules/impact.mjs units --base "$CI_BASE_SHA" --head "$CI_HEAD_SHA" --event "$CI_EVENT_NAME" --file "$RUNNER_TEMP/impact.json"
node tools/modules/impact.mjs browser --group cms --base "$CI_BASE_SHA" --head "$CI_HEAD_SHA" --event "$CI_EVENT_NAME" --file "$RUNNER_TEMP/impact.json"
node tools/modules/impact.mjs omit --job database-current --base "$CI_BASE_SHA" --head "$CI_HEAD_SHA" --event "$CI_EVENT_NAME" --file "$RUNNER_TEMP/impact.json"
```

`verifyPlan` rederives the complete plan from trusted base/head/event plus the current checkout. Never recover these trusted values from the downloaded plan. `sourceIdentity` is shared with the existing build artifact verifier: the commit and tracked tree include staged, unstaged and formatter-produced tracked changes. The plan records sorted changed paths/status, required and omitted jobs with reasons, literal test paths, and shard counts. Untracked inputs prevent omissions.

Main pushes, manual events, missing/invalid/non-ancestor bases, stale heads, additions/deletions/renames, package exports/dependencies, configuration, CI/tooling/harness changes and unknown paths select full verification. Both graph versions are not implemented, so additions and deletions deliberately stay broad. An empty change set does not authorize skipping tests. Missing/invalid model data fails the checks; new unit/integration/browser tests in existing runner roots also enter the full fallback selection.

## Ownership and non-import dependencies

`test-ownership.json` declares every existing unit, integration, browser, SQL and orchestration test. Adding a test requires an explicit responsibility entry. Unit selection unions declared responsibility with the current transitive source imports. Filesystem/process readers, unresolved local dependencies and tests without attributable source imports remain always-on. These tests often inspect CSS, SQL, deployment or runtime source through literal strings, so import reachability alone is insufficient.

Unsupported or unresolved test dependencies are retained as `testUnsupported` evidence. Any unknown browser/harness input forces a full plan, even when that consumer already exists in the base revision and only a leaf changes later. Unknown unit filesystem inputs remain always-on through unit ownership. The finite browser legal/template fixture reads use explicit literal URL maps, so their actual source files are visible without hash exceptions or guessing dynamic values.

The import graph is supplemented by explicit broad contracts:

- Public DOM/native IDs, CSS, fonts/assets and `/cms-public/source` protocol link public rendering, Studio capture/preview and published backend output.
- CMS document/schema/markup/resource formats and backend wire contracts require every current runtime consumer, SQL parity and release validation.
- SQL changes require customer/staff/CMS current database verification.
- Staff auth/session changes include the Studio owner gate.
- Root lint/typechecks, selected unit tests, boundary/orchestration/release checks, production bundling and startup remain broad gates where coupling persists.

Ordinary Studio changes select the complete CMS cohort plus `admin-shared.spec.mjs` (real Studio shell) and `admin-state.spec.mjs` (delivery retry/reload/copy races), with startup. The shared `admin-harness.tsx` imports many modules; behavioral responsibility determines spec ownership. Changing the harness itself selects full verification.

`WorkspaceView.tsx` deliberately remains broad: beyond workspace/focus/navigation flows, `cms-resources-harness.tsx` mounts it for engineering, resource workflow/usage and adversarial specs. The seven obvious workspace specs do not establish complete coverage.

One narrower seam is audited: **a sole modification to `DeliveryStatus.tsx`**. Its exact current callers must remain `DomainPanels.tsx`, `admin-harness.tsx` and `cms-delivery-status.spec.mjs`. It selects four CMS specs (delivery status, owner, workspace views, workspace edge), the two public Studio specs, and startup, with one CMS shard per engine. The delivery spec covers real Studio → Mejl → Leveransstatus navigation, switching back to templates and returning to the page; the dedicated adapter/harness cases cover request races. Any additional changed input, shared CSS/contract change or new caller restores broad selection. Tests pin both selection and fallback behavior.

## Local workspace commands

Each workspace exposes `check`, `test`, `lint`, `typecheck`, `build` and `plan` through `run.mjs`. Root location comes from the script URL, so npm workspace working directories are supported. A module `plan` is a whole-module local preview, not a CI authorization artifact.

```sh
npm run test --workspace @bladeblend/studio
npm run check --workspace @bladeblend/studio
node tools/modules/run.mjs studio test --dry-run
node tools/modules/run.mjs studio browser --dry-run
node tools/modules/run.mjs studio browser
node --test tools/modules/test-modules.mjs
```

`check` executes boundary validation, broad typechecks, module lint and selected native Vitest files. `build` uses the real root build because deployment is still composed at the root. Browser execution uses native Playwright, identical escaped literal spec arguments for discovery and execution, and the existing report verifier. Empty selections, missing outcomes, skips and retries do not pass. Public/startup browser commands still need their existing built test artifacts; customer/database verification still needs the real local stack.

Backend `typecheck` and `check` additionally run every Edge Function entrypoint with the same `deno check --config deno.json --frozen ./function/index.ts` command and working directory used in CI. Deno must be installed; a missing executable fails, never skips. Backend `lint` covers Worker ESLint (Edge TypeScript uses Deno checking). Backend `build` checks Edge entrypoints, builds the composed frontend/Worker inputs and runs Wrangler packaging with `deploy --dry-run`; it does not deploy. `node tools/modules/run.mjs backend database` runs native Supabase pgTAP against an already running local stack. The default `check` and `test` commands do not claim SQL runtime coverage. Other workspaces intentionally share root typecheck/build gates because they contribute source to one composed deployment rather than separate publishable bundles.
