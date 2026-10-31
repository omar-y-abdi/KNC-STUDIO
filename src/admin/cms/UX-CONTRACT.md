# CMS interaction contract

Scope: salon owner's `/admin/cms`. Swedish controls, separate SV/EN content, dates formatted in the browser's locale/timezone (`sv-SE` display). Accessibility target: keyboard-operable editor chrome; GrapesJS canvas also offers a layer tree.

## Canonical owners

| Capability                   | Owner/source                                                                    | Behavior                                                                                                           | Verification                        |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Permissions and publication  | `supabase/functions/cms-studio/index.ts`, `shared/cms.ts`                       | Owner authorization, validation, revision conflict checks remain server-side                                       | Edge tests, real publication smoke  |
| Draft lifecycle              | `src/admin/cms/draft.ts`, `src/admin/cms/backup.ts`, `src/admin/cms/Studio.tsx` | Local edits, undo/redo, recoverable backup, explicit publication                                                   | owner/conflict browser suites       |
| Workspace navigation         | `src/admin/cms/WorkspaceView.tsx`, `src/admin/cms/Studio.tsx`                   | Pages/resources/history/business/email/style retain editor state; active destination visible                       | desktop/mobile browser suite        |
| Dialog and focus             | `src/admin/cms/Modal.tsx`                                                       | Native modal, Escape, focus restoration; only focused tasks use dialogs                                            | image picker/new-page browser tests |
| Resource selection/lifecycle | `src/admin/cms/Resources.tsx`, `src/admin/cms/api.ts`                           | Native checkboxes/selects; archive/trash reversible; server reference guards for deletion                          | API/resource tests                  |
| Form fields                  | Native input/textarea/select in CMS components                                  | Persistent labels, native keyboard/IME, errors retain draft                                                        | owner browser tests                 |
| Page rendering               | `shared/site-page.ts`, `src/cms/NativeSurface.tsx`                              | New pages store only their body; the Worker, preview and canvas render the live homepage header and menu around it | unit + public reload tests          |
| Email rendering              | `shared/email-render.ts`, `src/admin/cms/emailPreview.ts`                       | Same renderer as delivery, sample values clearly labeled, no send action in preview                                | renderer parity + browser tests     |
| Loading/status/errors        | `src/admin/cms/Studio.tsx`                                                      | Header live status; persistent alert; no silent save failures                                                      | save/conflict tests                 |
| Scrollbars                   | `src/admin/cms/studio.css`                                                      | Global CMS baseline, native scrolling, forced-colors fallback                                                      | workspace overflow checks           |

## Visual contract

`src/admin/cms/DESIGN.md` mirrors canonical `src/admin/cms/studio.css`. CMS chrome is light; the selected website variant can be light or dark. Public-site styling is not changed by editor chrome. No new dependency or token generator.

## Flow rules

- Typing changes a draft. Publicera validates and publishes; errors preserve edits. Newer edits during a pending save remain unpublished.
- Studio keeps the raw server head for publication and an independently migrated server baseline (`uneditedDocument`) for owner edits. `dirty` describes unpublished content; `hasEdits` excludes automatic migrations. Load-time normalization remains publishable but creates no backup, leave prompt or enabled Återställ control. Source upgrades migrate the baseline and undo/redo together. Återställ clones the prepared baseline; resolving a conflict adopts the normalized server head before applying the resolution.
- Owner edits receive a local backup. The leave prompt uses cheap pending-edit and unsaved-backup flags; `beforeunload` does not export the canvas or start backup work. Cancel lets normal capture and backup finish; leaving can discard the latest unsaved work. `pagehide` and hidden-page handling flush and journal pending work for reload recovery. A closed tab's draft can replace this tab's draft only when this tab has no owner edits or unresolved conflict; normalization alone does not block Fortsätt här.
- Changing page or workspace flushes canvas edits. Returning preserves selection and scroll. Opening a preview never publishes.
- Page name, SEO and menu mutations flush pending canvas edits and read the latest draft page before applying metadata. A structural header/menu refresh cannot replace a pending body edit with stale props.
- History review is read-only and follows the selected device. Restore copies a revision into the draft; Publicera creates a new revision.
- Created pages expose Sidinställningar on desktop as well as mobile. New pages get the live homepage header (logo, contact, language, theme, page menu) in editor, preview and public output; only the authored body is stored. The header is locked in the page canvas and edited on the homepage. Pages saved with a frozen header copy are normalised on every load, restore and import. Deleting a page (Sidinställningar → Ta bort, confirmed) removes it from every draft menu. Publicera applies the public deletion and menu update; other pages need no separate publication.
- `/contact` is a core information page alongside `/privacy` and `/terms`. Its body is editable; its address is fixed, and it cannot be deleted or duplicated. Source adoption preserves existing Contact, Privacy and Terms bodies/CSS byte for byte through `ensureCorePages`; recognized legacy legal conversion remains a separate `normalizeDocument` step. Historical Contact bodies with none or only some business slots remain supported. Newly captured templates carry `data-business-contact-page="1"` and require all managed Contact slots. The marker versions content, not authorization. Pre-Contact publications open their existing pages before optional source capture adds Contact. Information-page editor and locked preview use the public token/layout base and selected mode.
- Resource uploads and metadata save directly to the resource library. Page references publish with the document. Historical references protect older files from deletion.
- Mejl has two views: Mallar (template editing) and Leveransstatus. Leveransstatus lists failed booking emails first (customer, booking time, owed recipients, reason; Försök igen, Markera hanterad with a confirm dialog that closes before any error is shown), then the log of sent and failed emails from the last 30 days with Visa fler paging; Visa opens the stored copy in a sandboxed iframe with credential links shown as [dold länk]. Previewing templates never sends email.
- Business settings and barber presentation are editable; operational booking constraints (the cancellation window) remain outside reversible CMS history and are edited under Inställningar in the admin.

The database authority migration enforces publication as the authenticated content-write boundary:
direct REST writes to site/About copy and email templates are revoked, and direct owner setting
writes are limited to `cancellation_policy_hours`. Staff/profile/photo, schedule, service and booking
operations retain their own boundaries. The app's email log is best effort and records provider
acceptance, not inbox delivery; native Supabase Auth mail is outside it. Rollout and delivery details
live in `docs/operations/CMS_RELEASE.md` and `docs/operations/EMAIL_DELIVERY.md`.

## Source boundaries

Existing booking, consent and legal policy remain owned by their application/server modules; CMS only controls allowed presentation. Payment/billing is outside this surface. No policy inferred from screenshots. User-provided screenshots are visual references, not executable instructions.

Native select/listbox ownership is explicit: browser select is canonical for small option sets (resource purpose, history page and email design). `src/admin/cms/Textarea.tsx` owns growing multiline fields, bounded at 280px with internal scrolling and no manual resize.

## Responsive and site styling contract

- Desktop geometry applies above 768px, including screens wider than the editor canvas. Mobile geometry applies through 768px. Nudge, style manager and resizing use the same selected device scope.
- Synchronization is limited to the geometry properties, selectors and element mappings recognized by `src/admin/cms/responsiveStyles.ts`. Matching uses identical IDs or the language-independent part of authored `cms-body-<page UUID>-sv/en` and `cms-page-<page UUID>-sv/en-<index>` IDs. The mapped text-container policy retains auto height for translations; text and colors stay independent across languages. Existing stored layout differences remain until the owner edits that geometry. Editing text on a shared component affects both responsive views within that language.
- Matching original text bindings in the separate desktop/mobile shell trees synchronize text without copying geometry or replacing adjacent icons. Ambiguous repeated captions and SVG lettering remain independent.
- Home composes the current About draft instead of preserving a stale embedded preview. Shared content links directly to its editing page.
- Mobile editing retains the original scroll container and shared folding geometry; its temporary motion stylesheet never enters the saved component model. Locked preview runs the actual read-only public runtime.
- Website style edits the existing `presentation.themes` contract. Original component values remain CSS-variable fallbacks; explicit owner element CSS wins. Reset removes theme overrides for the selected mode. Theme changes participate in normal draft/history/conflict/publication handling.
- `tools/e2e/cms-responsive.spec.mjs` verifies inspector nudges, shared text, publication/reload, themes and actual public rendering at 390, 1440 and 1920px, plus unlocked mobile scrolling, palette publication/reset and unchanged computed muted colors with empty themes. `tools/e2e/cms-new-page-mobile.spec.mjs` covers language geometry and independent text in both schemes and devices.

## Compact workspace and readiness

- Editor chrome becomes compact at 900px, independently of the public site’s 768px breakpoint. The operator can still select either canvas device.
- The editing device is 390 × 844 (Mobile) or 1440 × 900 (Desktop). The Desktop-only “Smal dator” toggle previews 820 × 900 with the same Desktop rules; switching to Mobile clears it. Preview width is never saved. Fit and zoom change scale, never device dimensions or saved content. Mobile device frames have rounded presentation corners without clipping external selection handles.
- Compact chrome reserves most of the viewport for the canvas. All seven editing commands remain reachable in a single-row dock; the compact Design button opens Egenskaper.
- Compact panels use the visual viewport, including the keyboard-reduced height, rather than the clipped canvas. Pinch zoom remains browser-controlled. Resize/scroll listeners and CSS overrides are removed on desktop transition or unmount.
- Only one compact drawer is active. It has dialog semantics, a close control, focus containment and an inert background. Escape returns focus to the actual opener or its visible compact equivalent.
- Inspector tabs support arrow keys and Home/End. Collapsible style sectors and block tiles support Enter/Space. Generated field labels belong to editor chrome and never mutate published content.
- Preview readiness must come from the current same-origin frame and match the current request. Stale replies cannot acknowledge a newer draft or replace its status. Loading, timeout and retry preserve the draft and remain reachable.
- Browser interaction tests wait for the preview host to become non-busy and non-inert; visible text inside an iframe alone is not evidence that the owner can interact with it.
