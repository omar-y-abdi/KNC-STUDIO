# Codex handoff: five screenshot-reported CMS issues

## Stop point and ownership

This is an **unfinished checkpoint, not a finished fix or merge recommendation**. Omar explicitly stopped further implementation/testing and asked to commit the existing work, create a new PR on the previous branch, and hand it to Codex for **local** development. Do not restart the remote candidate-building loop.

- Repository: `omar-y-abdi/KNC-STUDIO`.
- Continue on **`fix/cms-startup-20260923`**, targeting `main`. PR #74 is already merged; this is its new follow-up PR, not an update to the closed PR.
- Base when checkpointed: `344ebe51ce83724a31020f9ed4976838c9152b7e` (merged #74).
- Last implementation/test commit: **`98329dc6b23c56600310befd60a72bd87dac5b4b`**.
- Implementation tree: `2976b1814a334b6128b29c2bf687c41e5c8644dc`.
- The three implementation commits are `6d647e8c0aab06bd391822d167958c20f0a911ca`, `c70f59b2de213431d0e890e4596a1d98da23be21`, and `98329dc6b23c56600310befd60a72bd87dac5b4b`. All are now on the requested branch via a non-forced fast-forward. The later handoff commit changes documentation only.
- No additional fix, test run, merge, deployment, SQL change, content publication, or deletion of owner backups was performed for this handoff. Creating the PR may trigger the repository's normal automatic CI; this checkpoint does not claim its result.

## What the owner reported

The source is the attached **`problem.zip`**, containing 15 numbered screenshots. Read each group in filename order. The original ZIP is a conversation attachment, not a tracked repository dependency; a local Codex checkout will not automatically have ChatGPT's `/mnt/data` paths. Keep supplied screenshots outside tracked application files.

| Group | Original report / required outcome |
| --- | --- |
| **1a–1b** | Bokningsvillkor is white, background is reported as `none`, and changing it reveals a mismatch with the actual site's appearance. Legal page styling must agree between the selected light/dark editor mode and the rendered site. |
| **2a–2e** | New-page creation is broken: blue top banner, scattered layout, read-only controls, and inability to move/recolor content. Switching mobile/desktop corrupts the layout; leaving and returning only temporarily restores it. A genuinely new authored page must own its whole editable layout, without weakening protections on real booking/native components. |
| **3a–3d** | Clicking **Aktivera design** in email editing unexpectedly changes colors, rounded corners and layout. Merely enabling controls must preserve the existing email appearance; preview and delivered HTML must use the same rendering semantics. |
| **4a–4b** | Booking scene **Dag, behandling och tid** is cropped in both mobile and desktop views. Scene framing must expose the complete content without saving preview-only offsets into the site's styles. |
| **5a–5b** | The right side of comparison changes fonts, invalidating the comparison. Font loading, family, weight, size and resulting text geometry must match the corresponding real view. |

The existing approved visual direction is not permission for another redesign. Preserve the startup work merged in #74 and all booking/publication safeguards.

## Existing implementation, by issue

### 1. Legal background / selected mode

`shared/cms-mode-css.ts` adds `modeCss`, which resolves standalone `prefers-color-scheme` media queries against the explicitly selected CMS mode rather than the operating system. `src/admin/cms/nativeCanvas.ts` applies it to non-native page CSS. `src/worker.ts` applies the same transform to published light/dark page styles. `Editor.tsx` removes the forced white iframe body background and inherits the page colors.

The focused legal-background scenario passes in the last Chromium and WebKit run. This is not yet a full live-production verification of every background control. `modeCss` deliberately handles standalone color-scheme queries; do not silently claim that arbitrary compound media conditions are covered.

### 2. New-page ownership and device switching — main unfinished area

`CmsPage` now has optional `layout: 'independent'`, accepted only for non-core authored pages by `validatePresentation` in `shared/cms.ts`. Existing records without the field remain supported.

`shared/site-page.ts` adds `createSitePage`. It materializes the existing site's header/menu/content/footer into a page-owned layout and normalizes inline styles for both languages and modes. `renderSitePage` returns the saved complete layout for independent pages rather than recomposing it from another page. Existing body-only authored pages are materialized before editing; both languages are prepared before setting the page-wide ownership flag.

`Studio.tsx` creates independent pages. `Editor.tsx` uses the same materialization for editing/comparison and no longer strips header/footer changes from exported authored pages. Block insertion respects a selected authored header rather than forcing content into the body. `editorPolicy.ts` removes special read-only treatment of authored chrome while keeping native identities/required-component safeguards.

The latest `editableChromeCss` change lowers the specificity of seeded `#cms-site-*` rules and removes their `!important` flags so owner controls can override defaults. **This is not finished:** it currently has a TypeScript error, a header-contrast regression, and an incomplete UI-to-publication test. Do not mark issue 2 fixed based only on `stylable`/`draggable` model flags.

### 3. Email activation parity

`shared/email-render.ts` delegates both null/default designs and explicit designs to `renderDesignedEmail` in `shared/cms-email.ts`. The latter accepts the default design and preserves the existing delivered-email presentation while exposing controls. Unit tests compare default versus activated design output, including template variants. The focused browser activation scenario passes in both engines.

This affects shared delivery code, not just the editor. `supabase/functions/_shared/email.ts` imports/re-exports the shared renderer. Deployment and real delivery parity still need review once the branch is fixed; fixture success is not evidence of a production email deployment.

### 4. Booking-scene cropping

`src/admin/cms/canvasBehavior.ts` adds canvas-only block layout and insets for `booking-options`. Focused measurements show nonzero left/top insets and no horizontal overflow at 390px and 1440px canvas widths. Existing `cms-scenes` runs pass in both engines. Still verify actual content visibility and that transient scene CSS never enters published content.

### 5. Comparison fonts

The comparison iframe in `Editor.tsx` changes from an opaque-origin sandbox to `sandbox="allow-same-origin"`, without allowing scripts. The focused scenario compares loaded font, family, weight, size and text bounds between views and passes in both engines. Retain the no-script sandbox and markup-validation boundary when reviewing this change.

## Last recorded verification — known failures remain

Read [Actions run 35880214295, CMS five reported issues #8](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/35880214295). The downloaded core, Chromium and WebKit artifacts all identify implementation commit `98329dc6b23c56600310befd60a72bd87dac5b4b`. These are **existing results**, not tests rerun during handoff.

| Check | Recorded result |
| --- | --- |
| `npm test` | 796 passed in 115 test files. |
| `npm run typecheck` | **FAIL**, exit 2. |
| `npm run build` | **FAIL**, exit 2, same TypeScript failure before Vite builds. |
| `npm run lint` | **FAIL**, exit 1. |
| `cms-reported`, Chromium and WebKit | **FAIL**: `2-owner-controls-survive-publication`; the other recorded scenarios pass. |
| `cms-owner`, Chromium and WebKit | **FAIL**: `custom-page-styles` header contrast. |
| `cms-scenes`, Chromium and WebKit | PASS. |

### Exact blockers and first next steps

1. **TypeScript:** `shared/site-page.ts:176`, TS2322. `parse(..., { context: 'selectorList' })` returns the general `CssNode` type but `rule.prelude` accepts `Raw | SelectorList`. Narrow/check the AST result at the assignment; do not disable type checking or apply an unexplained broad cast. No correction has been made at this checkpoint.
2. **Lint:** `tools/e2e/cms-reported.mjs:198`, `structuredClone` is not defined (`no-undef`). Resolve the actual Node/browser evaluation context using the repository's existing global conventions. Do not disable the rule for the file.
3. **Real owner-control test:** `tools/e2e/cms-reported.mjs:163–220`, particularly line 168. After selecting `#cms-site-header > div` and opening **Yta & kanter**, `getByRole('textbox', { name: 'Bakgrundsfärg', exact: true }).fill(...)` times out after 15000ms in both engines. Inspect selection, inspector rendering and the accessible input type/name locally. It is **not established** whether this is a locator defect or an unavailable UI control. The test has not reached the subsequent padding, insert, publish and reload assertions. Preserve all of those assertions after resolving the initial failure.
4. **Header contrast:** `tools/e2e/cms-owner.mjs`, scenario `custom-page-styles`: “Converting header controls to links must retain their original contrast.” Actual is `rgb(28, 28, 30)`; expected is `rgb(255, 255, 255)` in both engines. Trace `renderSitePage`/`chrome`, button-to-anchor conversion, `normalizeSitePageContent`, `editableChromeCss` and the theme cascade. The recent specificity reduction is a relevant suspect, **not a proven final diagnosis**. Restore both inherited contrast and editable owner overrides; do not merely update the expectation.

Once those blockers are corrected, demonstrate: create page → edit header background/padding/text → move/add content → switch device repeatedly → switch both languages and themes → publish → reload → verify actual rendered output. Do not replace a UI interaction test with a direct model mutation and call that the same proof.

## Local continuation

Start from a clean or deliberately preserved local checkout; do not reset an existing working tree or overwrite another agent's changes.

```bash
git fetch origin
# Fresh checkout only; an existing local branch should be updated with --ff-only.
git switch --track origin/fix/cms-startup-20260923
npm ci
npx playwright install chromium webkit
```

Use Node 22, matching the recorded runner. The known failures should be corrected locally, not by adding more remote transport workflows. In one terminal, start the isolated fixture server:

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

Before final delivery run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `node tools/release/cms-release.mjs check`, then the repository's workspace/startup and real local Worker/Edge/database acceptance gates. Consult the existing workflows for the latter instead of inventing credentials. No commands in this section were executed during handoff.

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

Keep the PR draft until the four blockers above are addressed and all five screenshot groups are verified through real controls, persistence and fresh visual inspection. Preserve public booking/authentication protections, no-write preview isolation, owner drafts, and the startup behavior from #74. Do not merge or publish CMS content as part of merely taking over this checkpoint.
