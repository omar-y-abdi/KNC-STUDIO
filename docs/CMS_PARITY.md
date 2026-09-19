# o-y-a → KNC CMS parity

Status is accepted only after browser verification. This inventory prevents silent feature cuts.

| Capability                                | KNC status | Notes                                                                                          |
| ----------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Actual page HTML/CSS is GrapesJS document | PORTED     | CmsEditor uses setComponents/setStyle; Worker serves the same published variants.              |
| Desktop studio shell                      | PORTED     | Pages/resources + canvas + Design/Layers/Add + command bar.                                    |
| Real mobile drawers                       | PORTED     | Sidor and Egenskaper are viewport drawers, not an iframe simulation.                           |
| Desktop 1440 / Mobile 390 devices         | PORTED     | GrapesJS DeviceManager.                                                                        |
| Compare view                              | PORTED     | Opposite responsive viewport rendered beside canvas.                                           |
| Fit / zoom                                | PORTED     | Studio-only Canvas zoom.                                                                       |
| Direct text/link/image traits             | PORTED     | Inspector + GrapesJS traits/assets.                                                            |
| Resize handles                            | PORTED     | GrapesJS resizable policy for ordinary components.                                             |
| Layers / drag / reorder                   | PORTED     | GrapesJS LayerManager.                                                                         |
| Add blocks                                | PORTED     | Section, container, columns, heading, text, image, link/button, divider.                       |
| Parent selection                          | PORTED     | Inspector action.                                                                              |
| Duplicate/delete                          | PORTED     | Protected runtime slots excluded.                                                              |
| 1 px / Shift 10 px nudge                  | PORTED     | Independent CSS translate; transform remains intact.                                           |
| Rotation/transform                        | PORTED     | GrapesJS StyleManager transform controls.                                                      |
| Advanced CSS                              | PORTED     | Browser CSS.supports; server parser remains publication boundary.                              |
| Global/per-element styling                | EXTENDED   | GrapesJS element styles plus light/dark document variants and uploaded fonts.                  |
| View-state restoration                    | PORTED     | Selection + canvas scroll per page.                                                            |
| Lock/preview                              | PORTED     | GrapesJS preview command.                                                                      |
| Page create/duplicate/rename/delete       | PORTED     | Protected core routes cannot be deleted.                                                       |
| Page SEO/menu/internal links              | EXTENDED   | KNC localized title/description + menu state.                                                  |
| Resource picker/AssetManager              | PORTED     | Same CMS inventory feeds GrapesJS.                                                             |
| Image + WOFF2 upload                      | EXTENDED   | Existing KNC upload gateway validates purpose/MIME/WOFF2.                                      |
| Active/archive/trash/delete               | EXTENDED   | Current/history reference guards + recoverable trash.                                          |
| Immutable resource replacement            | PORTED     | Upload new object, remap current draft, retain old history.                                    |
| Draft recovery                            | PORTED     | Per-tab local backup.                                                                          |
| Undo/redo/revert                          | PORTED     | GrapesJS + document draft history.                                                             |
| History/restore-as-draft                  | PORTED     | Immutable revisions; restore never silently publishes.                                         |
| JSON export/import                        | PORTED     | Import is server-validated before becoming draft.                                              |
| Idempotent save retry                     | PORTED     | Stable request ID while save is pending.                                                       |
| Two-tab conflict                          | PORTED     | CAS plus three-way merge for independent structured edits; page arrays stay atomic on overlap. |
| Safe SVG editing                          | PORTED     | Existing markup validator + SVG presentation style sector.                                     |
| Business/SEO                              | EXTENDED   | KNC business identity/contact/address/map and localized SEO.                                   |
| Barber copy                               | EXTENDED   | CMS history edits presentation copy only; bookability remains operational.                     |
| Salon/cuts/logo/profile resources         | EXTENDED   | Purpose-aware KNC resource inventory.                                                          |
| Legal authoritative slots                 | EXTENDED   | Protected privacy/terms slots enriched by Worker after publication.                            |
| Email families                            | EXTENDED   | All KNC template families exposed with design controls and preview.                            |
| Failed-delivery operations                | EXTENDED   | Reachable from Studio but intentionally operational/non-reversible.                            |
| Booking/customer runtime                  | EXTENDED   | Protected islands mount code-owned behavior into editor-owned presentation.                    |
