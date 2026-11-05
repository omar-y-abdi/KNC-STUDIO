# Module boundaries acceptance

- [x] Verify base branch and current package/CI/preview/release premises.
- [x] Inventory frontend, backend and CI dependencies without changing behavior.
- [x] Introduce real workspace ownership and restricted exports; eliminate cross-area private imports and package cycles.
- [x] Expose public preview protocol/runtime; preserve isolation, readiness and native DOM identity.
- [x] Keep Deno, Worker, build, release and test consumers working after source movement; fresh-checkout path defects corrected.
- [x] Add complete test/input ownership and deterministic affected planning with explicit runtime/SQL/CSS edges.
- [x] Prove local panel selection, transitive contract/schema selection and full fallback on uncertain inputs.
- [x] Wire CI to source-bound plans and preserve strict aggregate/case-accounting checks.
- [x] Integrate parent CI repair `a719093`; recheck parent before final handoff.
- [x] Run local build/unit/selected-browser qualification and independent adversarial review.

The full database/history/browser graph remains the hosted PR gate. Its current execution status
is reported by GitHub checks; local evidence and limitations are recorded in
`docs/qa/2026-11-05-module-boundaries.md`.

Extraction reviewed through `6cc7e41`. Independent review reproduced the lost Studio route-load
recovery UI against both base and candidate. The fix restored the outer boundary; all four
slash-form/browser recovery cases passed independently. Initial independent whole-unit run at
`c2275eb` passed 2312/2313 cases with one existing 5-second Contact test timeout while the build
ran concurrently. Final frozen-head verification must run without that competing build; no test
timeout was raised. The frozen `002f9db` run subsequently passed all 2,313 tests. Module/CI contracts
passed 54 checks, and the affected proof executed 1,284 selected unit tests plus 150 browser cases.
Independent production build, Worker packaging and all 14 Deno entrypoints passed after the route
recovery fix; the boot bundle is 111.6 kB gzip against the unchanged 115 kB limit.
