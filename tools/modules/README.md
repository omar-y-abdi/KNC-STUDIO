# Module boundaries and local commands

`boundaries.mjs` parses production TypeScript/JavaScript with the installed TypeScript parser. It resolves static imports, re-exports, import types, literal dynamic imports, literal `import.meta.resolve(...)` calls, CommonJS dependency forms, and `new URL(..., import.meta.url)` assets/workers. Comments and source strings are not imports. Nonliteral imports and other `import.meta` dependency operations fail the check. Local production dependencies must resolve.

The six workspaces have explicit file exports and declared dependency directions. Browser code crosses packages through bare exports; Studio cannot import the public app or source-preview implementation. Public interfaces also have consumer-specific allowlists. Deno functions and portable contracts may retain explicit relative `.ts` imports to exact exported source files in declared packages. Remote Deno imports remain the responsibility of the real Deno CI gate. Test harnesses may inspect private implementation; the check does not read them.

Owned and public stylesheets are parsed with the installed `css-tree` parser. CSS imports and resource URLs obey package boundaries, including escaped identifiers/function names, encoded paths, root URLs and string forms in `image-set`. Local styles and public fonts/assets resolve to real files; relative or root-URL access to another package's private styles is rejected. Opaque remote/data CSS dependencies, malformed encodings and parser fallback syntax are rejected rather than treated as complete edges.

## Local workspace commands

Each workspace exposes `check`, `test`, `lint`, `typecheck` and `build` through `run.mjs`. Root location comes from the script URL, so npm workspace working directories are supported.

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
