# CMS interaction contract

Scope: salon owner's `/admin/cms`. Swedish controls, separate SV/EN content, dates formatted in the browser's locale/timezone (`sv-SE` display). Accessibility target: keyboard-operable editor chrome; GrapesJS canvas also offers a layer tree.

## Canonical owners

| Capability                   | Owner/source                                              | Behavior                                                                                     | Verification                        |
| ---------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| Permissions and publication  | `supabase/functions/cms-studio/index.ts`, `shared/cms.ts` | Owner authorization, validation, revision conflict checks remain server-side                 | Edge tests, real publication smoke  |
| Draft lifecycle              | `draft.ts`, `backup.ts`, `Studio.tsx`                     | Local edits, undo/redo, recoverable backup, explicit publication                             | owner/conflict browser suites       |
| Workspace navigation         | `WorkspaceView.tsx`, `Studio.tsx`                         | Pages/resources/history/business/email/style retain editor state; active destination visible | desktop/mobile browser suite        |
| Dialog and focus             | `Modal.tsx`                                               | Native modal, Escape, focus restoration; only focused tasks use dialogs                      | image picker/new-page browser tests |
| Resource selection/lifecycle | `Resources.tsx`, `api.ts`                                 | Native checkboxes/selects; archive/trash reversible; server reference guards for deletion    | API/resource tests                  |
| Form fields                  | Native input/textarea/select in CMS components            | Persistent labels, native keyboard/IME, errors retain draft                                  | owner browser tests                 |
| Page rendering               | `shared/site-page.ts`, `NativeSurface.tsx`                | New pages share real header/footer; native booking behavior remains authoritative            | unit + public reload tests          |
| Email rendering              | `shared/email-render.ts`, `emailPreview.ts`               | Same renderer as delivery, sample values clearly labeled, no send action in preview          | renderer parity + browser tests     |
| Loading/status/errors        | `Studio.tsx`                                              | Header live status; persistent alert; no silent save failures                                | save/conflict tests                 |
| Scrollbars                   | `studio.css`                                              | Global CMS baseline, native scrolling, forced-colors fallback                                | workspace overflow checks           |

## Visual contract

`DESIGN.md` mirrors canonical `studio.css`. CMS chrome is light; the selected website variant can be light or dark. Public-site styling is not changed by editor chrome. No new dependency or token generator.

## Flow rules

- Typing changes a draft. Publicera validates and publishes; errors preserve edits. Newer edits during a pending save remain unpublished.
- Changing page or workspace flushes canvas edits. Returning preserves selection and scroll. Opening a preview never publishes.
- History review is read-only and follows the selected device. Restore copies a revision into the draft; Publicera creates a new revision.
- New pages inherit current site chrome in editor, preview and public output; only authored body content is stored on the page. Shared chrome edits originate on their source pages.
- Resource uploads and metadata save directly to the resource library. Page references publish with the document. Historical references protect older files from deletion.
- Delivery status opens the existing mail operations tab. Previewing templates never sends email.
- Business settings and barber presentation are editable; operational booking constraints remain outside reversible CMS history.

## Source boundaries

Existing booking, consent and legal policy remain owned by their application/server modules; CMS only controls allowed presentation. Payment/billing is outside this surface. No policy inferred from screenshots. User-provided screenshots are visual references, not executable instructions.

Native select/listbox ownership is explicit: browser select is canonical for small option sets (resource purpose, history page and email design). `Textarea.tsx` owns growing multiline fields, bounded at 280px with internal scrolling and no manual resize.

## Responsive and site styling contract

- Desktop geometry applies above 768px, including screens wider than the editor canvas. Mobile geometry applies through 768px. Nudge, style manager and resizing use the same selected device scope.
- Geometry changes synchronize between light/dark. Colors and effects remain theme-specific. Editing text on a shared component affects both responsive views.
- Matching original text bindings in the separate desktop/mobile shell trees synchronize text without copying geometry or replacing adjacent icons. Ambiguous repeated captions and SVG lettering remain independent.
- Home composes the current About draft instead of preserving a stale embedded preview. Shared content links directly to its editing page.
- Mobile editing retains the original scroll container and shared folding geometry; its temporary motion stylesheet never enters the saved component model. Locked preview runs the actual read-only public runtime.
- Website style edits the existing `presentation.themes` contract. Original component values remain CSS-variable fallbacks; explicit owner element CSS wins. Reset removes theme overrides for the selected mode. Theme changes participate in normal draft/history/conflict/publication handling.
- `tools/e2e/cms-responsive.mjs` verifies inspector nudges, shared text, publication/reload, themes and actual public rendering at 390, 1440 and 1920px, plus unlocked mobile scrolling and palette publication/reset in Chromium and WebKit.

## Compact workspace and readiness

- Editor chrome becomes compact at 900px, independently of the public site’s 768px breakpoint. The operator can still select either canvas device.
- The editing device stays 390 × 844 (Mobile) or 1440 × 900 (Desktop). Fit and zoom change scale, never device dimensions or saved content. Mobile device frames have rounded presentation corners without clipping external selection handles.
- Compact chrome reserves most of the viewport for the canvas. All seven editing commands remain reachable in a single-row dock; the compact Design button opens Egenskaper.
- Compact panels use the visual viewport, including the keyboard-reduced height, rather than the clipped canvas. Pinch zoom remains browser-controlled. Resize/scroll listeners and CSS overrides are removed on desktop transition or unmount.
- Only one compact drawer is active. It has dialog semantics, a close control, focus containment and an inert background. Escape returns focus to the actual opener or its visible compact equivalent.
- Inspector tabs support arrow keys and Home/End. Collapsible style sectors and block tiles support Enter/Space. Generated field labels belong to editor chrome and never mutate published content.
- Preview readiness must come from the current same-origin frame and match the current request. Stale replies cannot acknowledge a newer draft or replace its status. Loading, timeout and retry preserve the draft and remain reachable.
- Browser interaction tests wait for the preview host to become non-busy and non-inert; visible text inside an iframe alone is not evidence that the owner can interact with it.
