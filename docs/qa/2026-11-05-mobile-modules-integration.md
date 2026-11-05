# Mobile runtime integration into module workspaces

This checkpoint integrates frozen mobile commits `68bd7fbcd1ad7c2b1b7140d61e46c23437f39316`
and `e484e7d2348e8e7a779cafa0d5d02974234be7b4` onto module head
`9087de0587dae97e589135a8a68286e0b385b4d6` in branch `fix/mobile-runtime-followup`.
It adds no product behavior beyond those two mobile commits. Later mobile fixes and final
runtime qualification are separate checkpoints. The two original mobile QA documents describe
runs against the original source layout, not browser runs against this integrated checkout.

## Conflict resolution and ownership

- `canvasBehavior.ts` keeps the mobile author's viewport and reversible booking-scroll behavior,
  with `mobile-layout` and `preview` imports through the public workspace's existing interfaces.
- `turnstileContract.test.ts` keeps the author's complete managed/non-interactive/invisible matrix,
  lifecycle assertions, and module-layout imports.
- Git proposed moving the new `shared/turnstile-widget-mode.ts` into content-contracts. Widget mode
  is public frontend/build configuration, so it instead lives at
  `modules/public-web/src/booking/turnstileWidgetMode.ts`. Turnstile uses a local import; root Vite
  configuration uses the explicit `@bladeblend/public-web/turnstile-widget-mode` export. No shared
  miscellaneous package or CMS document dependency was introduced.
- The new CMS browser spec imports content contracts from their current location and loads Studio
  harness modules through `/modules/studio/src/` URLs. Existing translated browser URLs remain.
- All five new tests have explicit ownership: the widget-mode unit and three public browser specs
  belong to public-web; the CMS capture/canvas spec belongs to public-web, Studio and
  content-contracts. Discovery and assertions are preserved.

Source comparison with the frozen mobile head found identical `MobileSite.tsx`, `mobileFold.ts`,
and widget-mode implementation bytes. `App.tsx`, `Turnstile.tsx`, and `canvasBehavior.ts` differ
only in module import specifiers.

## Executed verification

Fresh `npm ci` completed in this worktree; no dependencies or lockfile were changed.

- `node tools/modules/boundaries.mjs`: 310 source files, 1,113 resolved local edges.
- `npm run typecheck`: passed.
- `npx vitest run tests/unit/turnstileWidgetMode.test.ts tests/unit/turnstileContract.test.ts tests/unit/mobileFold.test.ts tests/unit/performanceLifecycle.test.ts`:
  four files, 22 tests passed.
- `node --test tools/modules/test-modules.mjs`: 19 tests passed, including repository ownership,
  discovery, import boundaries and fail-closed selection.
- `node tools/release/cms-release.mjs check`: passed; the existing release stamp remains current.
- Changed TypeScript, JavaScript, JSON and Markdown: scoped ESLint/Prettier checks passed.
- `loadConfigFromFile({ command: 'serve', mode: 'development' })` from Vite: passed through the
  new exported widget-mode interface without starting a server or building.
- Native Playwright discovery for `booking-first-frame`, `mobile-keyboard`,
  `mobile-booking-scroll`, and `mobile-viewport`: 42 tests in four files, across Chromium,
  Firefox and WebKit.
- Native CMS Playwright discovery for `cms-mobile-booking-scroll`: two tests in one file,
  across Chromium and WebKit.

## Deliberately not executed

No production build, browser execution, Worker packaging, deployment, migration, push or PR
creation. Browser discovery proves selection/import loading only. Final browser/runtime
qualification waits for the coordinated mobile follow-ups and available CPU capacity.
