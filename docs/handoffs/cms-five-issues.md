# Codex handoff: five screenshot-reported CMS issues

## Current local continuation — 2026-09-23

This status supersedes the checkpoint below, which records the state at commit
`98329dc6b23c56600310befd60a72bd87dac5b4b`. Work continues on
`fix/cms-startup-20260923`; PR #75 remains a draft. The original screenshot reports remain the
acceptance scope.

| Area                             | Current evidence                                                                                                                                                                                                                                                                              | Remaining work                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Unit tests                       | 817 tests in 117 files passed.                                                                                                                                                                                                                                                                | Rerun only if subsequent source changes require it. |
| Static and release checks        | Typecheck, lint, format check, production build, release stamp and dependency audit pass.                                                                                                                                                                                                     | None currently reported.                            |
| CMS editor and startup           | Built startup passed all 10 scenarios in Chromium and WebKit. Public first-paint passed in Chromium, Firefox and WebKit; the only sampled opacity was 0.18 across load and reload. The no-JavaScript fallback appeared when scripting was disabled. Standard public smoke passed in Chromium. | None currently reported for these gates.            |
| Workspace and privacy            | Workspace Views passed 374 checks, 308 screenshots, 114 axe states and zero violations. Responsive privacy passed 15 checks across Chromium, Firefox and WebKit.                                                                                                                              | None currently reported for these gates.            |
| Native routes and Edge           | All 13 Edge entrypoints and all 16 reported scenarios passed. The final isolated customer run passed owner UI → Edge/database publication, Worker rendering/reload and customer flows in Chromium, Firefox and WebKit with a 1,115,742-byte presentation.                                     | None currently reported for local acceptance.       |
| Owner, projection and responsive | Owner passed 38 cases. Projection and responsive suites passed in Chromium and WebKit, including 390, 1440 and 1920px widths. Legal background UI, publication and reload pass in both browser engines.                                                                                       | None currently reported for these gates.            |
| Email, booking and comparison    | Email activation, full-page booking scenes and comparison pass in Chromium and WebKit.                                                                                                                                                                                                        | None currently reported for these gates.            |
| Mobile About                     | Chromium and WebKit marquee checks pass, including the two-barber loop, reduced motion, editor → Home legacy projection and inspector publication/reload. Chrome review confirms the editor’s collapsed photo/name card fits; the public expanded profile reveals its details.                | None currently reported for the gallery gate.       |
| Release state                    | No production deployment, publication or merge has been performed. These are local results; remote CI is tied to each pushed commit.                                                                                                                                                          | Keep PR #75 draft for owner review.                 |

Original screenshots and current public mobile About fixture captures were inspected in Chrome from read-only local evidence servers. These captures are local visual evidence, not proof of production deployment or email delivery.

## Historical checkpoint and ownership at the original handoff

This section records the handoff state before the local continuation above. It is historical; use the current status table for open work. Omar explicitly stopped remote implementation/testing and asked to commit the existing work, create a new PR on the previous branch, and hand it to Codex for **local** development. Do not restart the remote candidate-building loop.

- Repository: `omar-y-abdi/KNC-STUDIO`.
- Continue on **`fix/cms-startup-20260923`**, targeting `main`. PR #74 is already merged; this is its new follow-up PR, not an update to the closed PR.
- Base when checkpointed: `344ebe51ce83724a31020f9ed4976838c9152b7e` (merged #74).
- Last implementation/test commit: **`98329dc6b23c56600310befd60a72bd87dac5b4b`**.
- Implementation tree: `2976b1814a334b6128b29c2bf687c41e5c8644dc`.
- The three implementation commits are `6d647e8c0aab06bd391822d167958c20f0a911ca`, `c70f59b2de213431d0e890e4596a1d98da23be21`, and `98329dc6b23c56600310befd60a72bd87dac5b4b`. All are now on the requested branch via a non-forced fast-forward. The later handoff commit changes documentation only.
- No additional fix, test run, merge, deployment, SQL change, content publication, or deletion of owner backups was performed for this handoff. Creating the PR may trigger the repository's normal automatic CI; this checkpoint does not claim its result.

## Historical owner report and acceptance criteria

The source is the attached **`problem.zip`**, containing 15 numbered screenshots. Read each group in filename order. The original ZIP is a conversation attachment, not a tracked repository dependency; a local Codex checkout will not automatically have ChatGPT's `/mnt/data` paths. Keep supplied screenshots outside tracked application files.

| Group     | Original report / required outcome                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a–1b** | Bokningsvillkor is white, background is reported as `none`, and changing it reveals a mismatch with the actual site's appearance. Legal page styling must agree between the selected light/dark editor mode and the rendered site.                                                                                                                              |
| **2a–2e** | New-page creation is broken: blue top banner, scattered layout, read-only controls, and inability to move/recolor content. Switching mobile/desktop corrupts the layout; leaving and returning only temporarily restores it. A genuinely new authored page must own its whole editable layout, without weakening protections on real booking/native components. |
| **3a–3d** | Clicking **Aktivera design** in email editing unexpectedly changes colors, rounded corners and layout. Merely enabling controls must preserve the existing email appearance; preview and delivered HTML must use the same rendering semantics.                                                                                                                  |
| **4a–4b** | Booking scene **Dag, behandling och tid** is cropped in both mobile and desktop views. Scene framing must expose the complete content without saving preview-only offsets into the site's styles.                                                                                                                                                               |
| **5a–5b** | The right side of comparison changes fonts, invalidating the comparison. Font loading, family, weight, size and resulting text geometry must match the corresponding real view.                                                                                                                                                                                 |

The existing approved visual direction is not permission for another redesign. Preserve the startup work merged in #74 and all booking/publication safeguards.

## Implementation summary by issue

### 1. Legal background / selected mode

`shared/cms-mode-css.ts` adds `modeCss`, which resolves standalone `prefers-color-scheme` media queries against the explicitly selected CMS mode rather than the operating system. `src/admin/cms/nativeCanvas.ts` applies it to non-native page CSS. `src/worker.ts` applies the same transform to published light/dark page styles. `Editor.tsx` removes the forced white iframe body background and inherits the page colors.

The legal-background control, publication and reload scenarios pass in Chromium and WebKit. This is fixture acceptance, not a production publication. `modeCss` deliberately handles standalone color-scheme queries; compound media conditions are outside that transform.

### 2. New-page ownership and device switching

`CmsPage` now has optional `layout: 'independent'`, accepted only for non-core authored pages by `validatePresentation` in `shared/cms.ts`. Existing records without the field remain supported.

`shared/site-page.ts` adds `createSitePage`. It materializes the existing site's header/menu/content/footer into a page-owned layout and normalizes inline styles for both languages and modes. `renderSitePage` returns the saved complete layout for independent pages rather than recomposing it from another page. Existing body-only authored pages are materialized before editing; both languages are prepared before setting the page-wide ownership flag.

`Studio.tsx` creates independent pages. `Editor.tsx` uses the same materialization for editing/comparison and no longer strips header/footer changes from exported authored pages. Block insertion respects a selected authored header rather than forcing content into the body. `editorPolicy.ts` removes special read-only treatment of authored chrome while keeping native identities/required-component safeguards.

At handoff, the latest `editableChromeCss` change lowered the specificity of seeded `#cms-site-*` rules and removed their `!important` flags. The TypeScript and contrast failures listed below were present then. The current continuation narrows the parsed selector AST, lets explicit source colors override the inherited header fallback, and verifies contrast in both editor and public rendering. The isolated UI-to-publication path passes local Worker/Edge/database acceptance; do not substitute `stylable`/`draggable` model flags for that end-to-end proof.

### 3. Email activation parity

`shared/email-render.ts` delegates both null/default designs and explicit designs to `renderDesignedEmail` in `shared/cms-email.ts`. The latter accepts the default design and preserves the existing delivered-email presentation while exposing controls. Unit tests compare default versus activated design output, including template variants. The focused browser activation scenario passes in both engines.

This affects shared delivery code, not just the editor. `supabase/functions/_shared/email.ts` imports/re-exports the shared renderer. Deploy affected functions under the release process and verify real delivery separately; the editor preview does not send email.

### 4. Booking-scene cropping

`src/admin/cms/composedCanvas.ts` places the selected booking stage inside the existing booking-flow host while retaining the page shell and barber context. The options stage remains below the barber row; details and confirmation appear over that options flow. Scene composition is removed before native export, leaving one stored copy of every stage. The renamed `4-booking-full-page-scenes` acceptance passed in Chromium and WebKit, including mobile scroll reachability and legacy marker repair. No scene-specific inset or crop is saved to the site.

### 5. Comparison fonts

The comparison iframe in `Editor.tsx` changes from an opaque-origin sandbox to `sandbox="allow-same-origin"`, without allowing scripts. The focused scenario compares loaded font, family, weight, size and text bounds between views and passes in both engines. Retain the no-script sandbox and markup-validation boundary when reviewing this change.

## Original CI at the handoff — historical results

Read [Actions run 35880214295, CMS five reported issues #8](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/35880214295). The downloaded core, Chromium and WebKit artifacts all identify implementation commit `98329dc6b23c56600310befd60a72bd87dac5b4b`. These are **existing results**, not tests rerun during handoff.

| Check                               | Recorded result                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `npm test`                          | 796 passed in 115 test files.                                                          |
| `npm run typecheck`                 | **FAIL**, exit 2.                                                                      |
| `npm run build`                     | **FAIL**, exit 2, same TypeScript failure before Vite builds.                          |
| `npm run lint`                      | **FAIL**, exit 1.                                                                      |
| `cms-reported`, Chromium and WebKit | **FAIL**: `2-owner-controls-survive-publication`; the other recorded scenarios passed. |
| `cms-owner`, Chromium and WebKit    | **FAIL**: `custom-page-styles` header contrast.                                        |
| `cms-scenes`, Chromium and WebKit   | PASS.                                                                                  |

### Original blockers — historical diagnosis

These items explain the first handoff failures. Current gate state is in the table above; this list is not another set of open blockers.

1. **TypeScript:** selector-list parsing returned generic `CssNode`; the AST node is now narrowed before assigning the selector prelude.
2. **Lint:** the E2E scenario used a bare `structuredClone`; browser globals now use explicit `globalThis` access.
3. **Owner-control UI:** the test toggled an already-open **Yta & kanter** inspector section closed; it now opens the section only when `aria-expanded` is false.
4. **Header contrast:** the inherited fallback had higher specificity than normalized authored colors; `:where(#cms-site-header) a` supplies the fallback without ID specificity.

The comparison issue is resolved in the test contract: the editor's UI scrollbar reserves 8px inside its editing frame, while the comparison view checks native viewport parity and relative insets separately from actual font and glyph geometry. Both engines pass the focused scenario, with no product CSS workaround.

The isolated authored-page customer acceptance demonstrated create → edit header/background/padding/text → move/add content → switch devices, languages and themes → publish → reload through the local Worker/Edge/database path in Chromium, Firefox and WebKit. The final isolated run passed with the current CSS normalizer.

## Historical local continuation commands

These commands document the initial takeover procedure for a fresh checkout. Current work and gate status are listed above; do not reset or overwrite an existing working tree.

```bash
git fetch origin
# Fresh checkout only; an existing local branch should be updated with --ff-only.
git switch --track origin/fix/cms-startup-20260923
npm ci
npx playwright install chromium webkit
```

Use Node 22, matching the recorded runner. For a fresh reproduction, start the isolated fixture server:

```bash
VITE_SUPABASE_URL=https://admin-harness.invalid \
VITE_SUPABASE_ANON_KEY=e2e-public-anon-key \
npm run dev -- --host 127.0.0.1 --port 4188
```

In another terminal, run the reported suite first, preserving evidence outside the repo:

```bash
BASE_URL=http://127.0.0.1:4188 \
CMS_ENGINE=chromium CMS_EVIDENCE_DIR=/tmp/knc-cms-reported-chromium \
node tools/e2e/cms-reported.mjs
```

Repeat with `CMS_ENGINE=webkit` and a distinct evidence directory. Then run `cms-owner.mjs` and `cms-scenes.mjs` for each engine. `CMS_ENGINE` is supported by these scripts. These tests run real frontend components with intercepted backend boundaries; they do not themselves prove authenticated production publication.

Repeat `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `node tools/release/cms-release.mjs check` after any further source changes, followed by the existing workspace/startup and local Worker/Edge/database acceptance gates.

## Durable source and evidence pointers

- [Latest implementation](https://github.com/omar-y-abdi/KNC-STUDIO/commit/98329dc6b23c56600310befd60a72bd87dac5b4b).
- [Core diagnostics](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/35880214295/artifacts/10761040944), artifact `cms-five-core-8`.
- [Chromium results/screenshots](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/35880214295/artifacts/10760572336), artifact `cms-five-chromium-8`.
- [WebKit results/screenshots](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/35880214295/artifacts/10761067026), artifact `cms-five-webkit-8`.
- Remote verification inputs remain at commit `ba70def5d5d2fde3619fe417bc77db09a8f4be88` on `verify/cms-five-issues-20260923`. `.verification/extended.patch` and `.verification/correction.patch` were already applied to the checkpoint; **do not apply them again**. The old remote orchestrator is historical evidence, not the branch to continue editing.

```bash
gh run download 35880214295 --repo omar-y-abdi/KNC-STUDIO \
  --name cms-five-core-8 --name cms-five-chromium-8 --name cms-five-webkit-8 \
  --dir /tmp/knc-cms-five-evidence
```

The artifacts report expiry on 2026-09-30. Preserve them locally for the handoff; source and tests are committed independently of artifact retention. There are duplicate `cms-five-source-8` artifact names from reruns, so use the implementation commit rather than selecting an arbitrary source archive by name.

Key files inside browser artifacts: `cms-reported/reported-results.json`, `cms-reported.log`, `cms-owner.log`, individual `.exit-code` files, and `cms-reported/*-2-owner-controls-survive-publication-failure.png`. Raw diagnostics and Furl summaries are both retained. The no-failure screenshots show individual exercised states, not a final visual acceptance of all 15 original reports.

## Deployment and completion constraints

The branch includes a changed `shared/cms-release.ts` because `shared/cms.ts` now accepts the new authored-page layout field. Do not bypass the release check: a compatible `cms-studio` deployment must precede a frontend deployment that sends this field. Audit which email Edge Functions consume the changed shared renderer before claiming delivered-email parity. **Nothing in this checkpoint says that these new changes have been deployed.**

Keep PR #75 in draft for owner review. Preserve public booking/authentication protections, no-write preview isolation, owner drafts, and startup behavior from #74. Do not merge or publish CMS content as part of this local handoff.
