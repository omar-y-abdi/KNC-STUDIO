# o-y-a → KNC CMS parity

PORTED and EXTENDED describe implementation coverage. They do not certify browser verification of every control in this inventory. Merge evidence must refer to a CI run on the current PR commit.

The executable acceptance checks are:

- `tools/e2e/cms-native.mjs`: original desktop/mobile appearance, editor source capture, publication and fresh public reload in Chromium and WebKit.
- `tools/e2e/cms-owner.mjs` and `cms-populated.mjs`: owner edits and populated content through the editor and shared publication validators in both engines. These use a fixture backend.
- `tools/e2e/cms-projection.mjs`: actual nested components retain published text/image/style edits, callbacks, state, and newly loaded live entries in both engines.
- `tools/e2e/cms-scenes.mjs`: booking steps, details, confirmation and customer list editing/publication; ordinary runtime forms and changing customer data; mobile fold with no stored scroll styles. Chromium and WebKit, with optional published-presentation input.
- `tools/e2e/cms-public-regression.mjs`: repeated Home edit/publication/reload, bounded stored content, theme color and viewport backgrounds in Chromium/WebKit.
- `tools/e2e/cms-conflict.mjs`: explicit local/server conflict choices, stale backup recovery, and unresolved-conflict reload in both engines.
- `tools/e2e/smoke.mjs` with the local Supabase stack: a real owner publishes existing desktop/mobile copy through Edge and the database before customer booking/access/cancellation scenarios run in Chromium, Firefox, and WebKit. Public documents and APIs use the actual Worker through a local TLS bridge. Native HTML size and both edits in the public presentation API are asserted before browser navigation and reload checks.

Worker HTML rendering has unit coverage. Real owner publication and restoration were separately verified in production on September 21 (revisions 3–6). Email preview and sending now share `shared/email-render.ts`; parity tests compare generated HTML, not inbox-client rendering. Physical iPhone Safari and every resource lifecycle control remain outside those browser claims.

| Capability                                | KNC status | Notes                                                                                                                    |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Actual page HTML/CSS is GrapesJS document | PORTED     | CmsEditor uses setComponents/setStyle; native App projects published variants, custom/legal pages render through Worker. |
| Desktop studio shell                      | PORTED     | O-Y-A-based page library, contextual inspector, full workspace destinations and floating dock.                           |
| Real mobile drawers                       | PORTED     | Sidor and Egenskaper are viewport drawers, not an iframe simulation.                                                     |
| Desktop 1440 / Mobile 390 devices         | PORTED     | 1440×900 and 390×844 viewports; fit considers both dimensions.                                                           |
| Compare view                              | PORTED     | Opposite responsive viewport rendered beside canvas.                                                                     |
| Fit / zoom                                | PORTED     | Studio-only Canvas zoom.                                                                                                 |
| Direct text/link/image traits             | PORTED     | Inspector + GrapesJS traits/assets.                                                                                      |
| Resize handles                            | PORTED     | GrapesJS resizable policy for ordinary components.                                                                       |
| Layers / drag / reorder                   | PORTED     | GrapesJS LayerManager.                                                                                                   |
| Add blocks                                | PORTED     | Section, container, columns, heading, text, image, link/button, divider.                                                 |
| Parent selection                          | PORTED     | Inspector action.                                                                                                        |
| Duplicate/delete                          | PORTED     | Protected runtime slots excluded.                                                                                        |
| 1 px / Shift 10 px nudge                  | PORTED     | Independent CSS translate; transform remains intact.                                                                     |
| Rotation/transform                        | PORTED     | GrapesJS StyleManager transform controls.                                                                                |
| Advanced CSS                              | PORTED     | Browser CSS.supports; server parser remains publication boundary.                                                        |
| Global/per-element styling                | EXTENDED   | GrapesJS element styles plus light/dark document variants and uploaded fonts.                                            |
| View-state restoration                    | PORTED     | Selection + canvas scroll per page.                                                                                      |
| Lock/preview                              | PORTED     | Validated draft in a read-only native runtime frame; custom pages use sandboxed HTML/CSS.                                |
| Page create/duplicate/rename/delete       | PORTED     | New pages inherit current site header/logo/footer via one shared renderer; core routes cannot be deleted.                |
| Page SEO/menu/internal links              | EXTENDED   | KNC localized title/description + menu state.                                                                            |
| Resource picker/AssetManager              | PORTED     | Same CMS inventory feeds GrapesJS.                                                                                       |
| Image + WOFF2 upload                      | EXTENDED   | Existing KNC upload gateway validates purpose/MIME/WOFF2.                                                                |
| Active/archive/trash/delete               | EXTENDED   | Current/history reference guards + recoverable trash.                                                                    |
| Immutable resource replacement            | PORTED     | Upload new object, remap current draft, retain old history.                                                              |
| Draft recovery                            | PORTED     | Per-tab local backup.                                                                                                    |
| Undo/redo/revert                          | PORTED     | GrapesJS + document draft history.                                                                                       |
| History/restore-as-draft                  | PORTED     | Workspace timeline, read-only version review and restore-as-draft; restoration never publishes.                          |
| JSON export/import                        | PORTED     | Import is server-validated before becoming draft.                                                                        |
| Idempotent save retry                     | PORTED     | Stable request ID while save is pending.                                                                                 |
| Two-tab conflict                          | PORTED     | CAS plus three-way merge for independent structured edits; page arrays stay atomic on overlap.                           |
| Safe SVG editing                          | PORTED     | Existing markup validator + SVG presentation style sector.                                                               |
| Business/SEO                              | EXTENDED   | KNC business identity/contact/address/map and localized SEO.                                                             |
| Barber copy                               | EXTENDED   | CMS history edits presentation copy only; bookability remains operational.                                               |
| Salon/cuts/logo/profile resources         | EXTENDED   | Purpose-aware KNC resource inventory.                                                                                    |
| Legal authoritative slots                 | EXTENDED   | Protected privacy/terms slots enriched by Worker after publication.                                                      |
| Email families                            | EXTENDED   | All nine families use the actual outgoing renderer, sample data and desktop/mobile previews.                             |
| Failed-delivery operations                | EXTENDED   | Reachable from Studio but intentionally operational/non-reversible.                                                      |
| Booking/customer runtime                  | EXTENDED   | Protected islands mount code-owned behavior into editor-owned presentation.                                              |
