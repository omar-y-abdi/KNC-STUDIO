# Mobile runtime integration into module workspaces

The initial checkpoint integrates frozen mobile commits `68bd7fbcd1ad7c2b1b7140d61e46c23437f39316`
and `e484e7d2348e8e7a779cafa0d5d02974234be7b4` onto module head
`9087de0587dae97e589135a8a68286e0b385b4d6` in branch `fix/mobile-runtime-followup`.
That checkpoint adds no product behavior beyond those two mobile commits. Later mobile fixes
and final runtime qualification are separate checkpoints, recorded below when integrated. The two original mobile QA documents describe
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

Source comparison at the initial checkpoint with the frozen mobile head found identical `MobileSite.tsx`, `mobileFold.ts`,
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

## Exact source-to-integration commit mapping

The accumulated integration branch is the candidate for existing PR #174. It is not a separate
PR; root will publish only after the complete package's independent qualification.

| Frozen original commit                     | Ported integration commit                  | Scope                                                    |
| ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| `68bd7fbcd1ad7c2b1b7140d61e46c23437f39316` | `8b986f9fa05e0237b87d460713754fecf472ec6c` | Initial verification layout and mobile viewport geometry |
| `e484e7d2348e8e7a779cafa0d5d02974234be7b4` | `5c6d9b815871e480206f6eb720d07a24e15cb132` | Reversible mobile booking hero scrolling                 |
| `80542272d49dfb92af02b191bf2fce73861550f9` | `6cab1035b80e52bdf3d765d9c60feadf965edbed` | Review authorization recovery                            |

Smoothing source `e3ba2d8b6596b9e56c4ed07a4e257250e5a06352` maps to integration commit
`b39a21bf80762c1082c753f2c2c9f8575cbc2929`.

`91632a2a5bfa71d84980a13a75ae5322027ea425` completes the initial two-commit integration's
CMS harness paths, test ownership and recorded checks. Subsequent qualification/ownership
commits do not add product behavior.

## Review authorization recovery checkpoint

Historical checkpoint: the email-first review action described here is superseded by
[Device review UI](2026-11-05-device-review-ui.md). Its recorded test counts belong to that
original checkpoint, not the replacement device-access flow.

Ported `8054227` directly onto the clean `91632a2` candidate. Git resolved the existing module
renames without conflicts. The new `review-recovery.spec.mjs` is byte-identical to the frozen
original and needs no URL/import translation; its public-web ownership is explicit. The
public booking action unit test differs only in imported/mock module paths, preserving its
same-origin review-credentials assertion. No SQL, storage or policy files changed.

Comparison against `8054227` found these nine production files byte-identical:

- `modules/public-web/src/about/AboutSection.tsx`
- `modules/public-web/src/about/reviewValidation.ts`
- `modules/public-web/src/about/reviews/domain.ts`
- `modules/public-web/src/app/DesktopSite.tsx`
- `modules/public-web/src/app/MobileSite.tsx`
- `modules/public-web/src/i18n/en.ts`
- `modules/public-web/src/i18n/index.ts`
- `modules/public-web/src/i18n/sv.ts`
- `modules/public-web/src/mybookings/MyBookingsDialog.tsx`

The remaining two changed production files differ only in imports: `App.tsx` uses the explicit
`../site/adapters/index` path; `supabaseReviews.ts` imports RPC schemas from
`@bladeblend/backend-contracts/rpcSchemas`, with formatter-required wrapping. UI copy,
retained-draft behavior, verification-session handling, and adapter behavior are unchanged
from the frozen original.

Executed on the integrated review checkpoint:

- Module boundaries: 310 source files, 1,113 resolved local edges.
- `npm run typecheck`: passed.
- Focused units (`publicBookingActions`, `reviewGatewayContract`, `reviewValidation`,
  `publicClientBoundary`, `publicAdapterRequests`, `publicCustomerInputSemantics`,
  `performanceLifecycle`, `cmsRuntimeMode`): eight files, 55 tests passed.
- CMS release stamp check: passed without changes.
- Test inventory: no errors; the new review-recovery spec belongs to public-web.
- Native Playwright discovery: nine review-recovery cases across Chromium, Firefox and WebKit.
- Scoped ESLint/Prettier checks: passed.

No build, browser execution, push or deployment was performed for this checkpoint. The source
QA document's browser/production observations remain the original author's evidence, not new
execution evidence from this integration worktree.

## Native scroll smoothing checkpoint

Ported frozen `e3ba2d8` onto `cd2274e`. Resolved only module-location/import conflicts:
`mobileFoldLayout.tsx` is private public-web app implementation; Studio consumes
`primeMobileFold` through the existing `mobile-layout` export. No new package interface was
added. The expanded CMS booking-scroll assertions remain intact with translated contract
imports and Studio harness URLs. The new priming unit and two Chromium paint specs have
explicit public-web/Studio/content-contract ownership as appropriate.

Compared directly with the frozen source: `MobileSite.tsx`, `mobileFold.ts`,
`mobileFoldLayout.tsx`, both new Chromium paint specs, `mobile-booking-scroll.spec.mjs`, and
`mobile-keyboard.spec.mjs` are byte-identical. `App.tsx` and `canvasBehavior.ts` differ only in
imports; unit/public-viewport/CMS-booking specs differ only in import/harness paths and related
formatting. `nativePages.ts` retains the already-integrated preview protocol constants and
Worker-path comment: `PUBLIC_PREVIEW_PATH` remains `/cms-public/source`, and
`PREVIEW_MESSAGE.context` remains `knc-source-context`. Its only new implementation change is
exactly the source commit's carrier removal before capture.

Executed on this integrated checkpoint:

- Module boundaries: 311 source files, 1,115 resolved local edges; inventory has no errors.
- `npm run typecheck`: passed.
- `mobileFoldPriming`, `mobileFold`, `performanceLifecycle`: three unit files, nine tests passed.
- CMS release check and scoped ESLint/Prettier: passed.
- Native CMS discovery: 11 cases in three files, including all nine new Chromium paint cases
  and the existing booking-scroll case in both Chromium and WebKit.
- Native public discovery: 36 cases in the three modified mobile browser specs.

No broad suite, build, browser execution or push was run here. Root owns final integrated
qualification and publication to PR #174. The original smoothing QA document is retained
unchanged as source-author evidence, not represented as a run against the integrated head.
