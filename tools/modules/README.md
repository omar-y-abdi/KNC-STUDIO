# Module boundaries and affected verification

`boundaries.mjs` parses production TypeScript/JavaScript with the installed TypeScript parser. It resolves static imports, re-exports, import types, literal dynamic imports, literal `import.meta.resolve(...)` calls, CommonJS dependency forms, and `new URL(..., import.meta.url)` assets/workers. Comments and source strings are not imports. Nonliteral imports and other `import.meta` dependency operations prevent affected verification. Local production dependencies must resolve.

The six workspaces have explicit file exports and declared dependency directions. Browser code crosses packages through bare exports; Studio cannot import the public app or source-preview implementation. Public interfaces also have consumer-specific allowlists. Deno functions and portable contracts may retain explicit relative `.ts` imports to exact exported source files in declared packages. Remote Deno imports remain the responsibility of the real Deno CI gate; import-map and lockfile changes select full verification. Test harnesses may inspect private implementation; a harness dependency that cannot be read or resolved is recorded as `testUnsupported`.

Owned and public stylesheets are parsed with the installed `css-tree` parser. CSS imports and resource URLs obey package boundaries, including escaped identifiers/function names, encoded paths, root URLs and string forms in `image-set`. Local styles and public fonts/assets resolve to real files; relative or root-URL access to another package's private styles is rejected. Opaque remote/data CSS dependencies, malformed encodings and parser fallback syntax are rejected rather than treated as complete edges. CSS/HTML and other non-script module source formats select full verification.

## Plans and trust

`tools/ci/impact-plan.mjs` creates the plan **after formatting**, from the exact Git commit SHAs and event in trusted workflow context (`CI_BASE_SHA`, `CI_HEAD_SHA`, `CI_EVENT_NAME`). Store artifacts outside the checkout or in the exact ignored CI artifact directories.

```sh
node tools/ci/impact-plan.mjs create "$RUNNER_TEMP/impact.json" # also writes one job=true|false line per job to $GITHUB_OUTPUT
node tools/ci/impact-plan.mjs verify # rederives .ci-source/impact.json
node tools/ci/impact-plan.mjs units
node tools/ci/impact-plan.mjs browser cms --project=cms-chromium --shard=1/9
```

`verifyPlan` rederives the complete plan from trusted base/head/event plus the current checkout. Never recover these trusted values from the downloaded plan. `sourceIdentity` is shared with the existing build artifact verifier: the commit and tracked tree include staged, unstaged and formatter-produced tracked changes. The plan records sorted changed paths/status, the reasons for full verification, and whether each job is required. Untracked inputs prevent omissions.

The plan is a path classifier with one rule. A pull request whose every changed path is an in-place modification of a TypeScript or JavaScript source file under `modules/studio/src/` or `modules/staff-admin/src/` omits the `edge-functions` and `database-current` jobs. Everything else requires every job: main pushes, manual events, missing/invalid/non-ancestor bases, stale heads, additions/deletions/renames, stylesheets, templates and data files, every other workspace, migrations, package manifests and lockfiles, configuration, CI/tooling/harness/test/documentation changes, unknown paths and an empty change set. A boundary error, or a browser or integration harness dependency recorded as `testUnsupported`, requires every job for every pull request until it is fixed.

The omission rests on dependency direction: the backend, and each workspace the backend may import, cannot import Studio or staff-admin. The omitted database job still exercises them, because integration tests import staff adapters and the customer flow publishes through Studio; for such a pull request those run on the push to `main`.

No plan selects individual tests. `units` runs the whole Vitest suite. `browser <group>` runs the whole Playwright group with only the given `--project`/`--shard`, identically for discovery and execution, and refuses a group whose job the plan omits. `tools/ci/verify-test-inventory.mjs` assigns each unit and browser test file on disk to its runner by path; the quality job requires native discovery to match those files exactly.

## Local workspace commands

Each workspace exposes `check`, `test`, `lint`, `typecheck`, `build` and `plan` through `run.mjs`. Root location comes from the script URL, so npm workspace working directories are supported. A module `plan` previews which CI jobs a pull request confined to in-place source edits of that workspace would run; it is not a CI authorization artifact.

```sh
npm run test --workspace @bladeblend/studio
npm run check --workspace @bladeblend/studio
node tools/modules/run.mjs studio test --dry-run
node tools/modules/run.mjs studio browser --dry-run
node tools/modules/run.mjs studio browser
node --test tools/modules/test-modules.mjs
```

`check` executes boundary validation, broad typechecks, module lint and the whole native Vitest suite; `test` runs that suite alone. Unit tests are not divided by workspace, so every workspace runs all of them. `build` uses the real root build because deployment is still composed at the root. `browser` runs the workspace's whole browser group (CMS for Studio, customer for the backend, public otherwise) with native Playwright, identical arguments for discovery and execution, and the existing report verifier. Missing outcomes, skips and retries do not pass. Public/startup browser commands still need their existing built test artifacts; customer/database verification still needs the real local stack.

Backend `typecheck` and `check` additionally run every Edge Function entrypoint with the same `deno check --config deno.json --frozen ./function/index.ts` command and working directory used in CI. Deno must be installed; a missing executable fails, never skips. Backend `lint` covers Worker ESLint (Edge TypeScript uses Deno checking). Backend `build` checks Edge entrypoints, builds the composed frontend/Worker inputs and runs Wrangler packaging with `deploy --dry-run`; it does not deploy. `node tools/modules/run.mjs backend database` runs native Supabase pgTAP against an already running local stack. The default `check` and `test` commands do not claim SQL runtime coverage. Other workspaces intentionally share root typecheck/build gates because they contribute source to one composed deployment rather than separate publishable bundles.
