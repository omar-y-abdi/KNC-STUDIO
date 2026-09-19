# KNC CMS Studio — implementation plan

Product contract: `/admin/cms/` is an owner-only visual studio where the actual published KNC presentation is the GrapesJS document. Runtime booking/auth/customer behavior stays code-owned behind protected contracts. The current operational admin remains available until manual acceptance.

Status legend: `[ ]` left · `[*]` WIP · `[x]` done.

## Architecture

- [*] Port the proven o-y-a studio shell and GrapesJS editor primitives; do not rebuild them.
- [ ] Define one canonical responsive page project for home, about, booking, customer bookings, privacy, terms and custom pages.
- [ ] Protect runtime/legal contracts while keeping ordinary presentation editable.
- [ ] Make editor, preview/lock, publication and fresh public reload consume the same validated HTML/CSS.
- [ ] Mount runtime behavior into protected islands without Preact replacing authored presentation.

## Studio UX

- [ ] Desktop: Sidor/Resurser · GrapesJS canvas · Design/Lager/Lägg till · bottom command bar.
- [ ] Real mobile: Sidor and Egenskaper drawers, touch-safe editing and reachable command bar at 390×844.
- [ ] Desktop 1440 / Mobile 390 / Compare / fit + zoom / device-only styles.
- [ ] Direct text/link/image editing; parent select; duplicate/delete; resize; drag/reorder; blocks.
- [ ] Full style surface including layout, grid/flex, typography, spacing, border, shadows, opacity, filters, SVG fill/stroke, transform/rotation and validated advanced CSS.
- [ ] 1 px nudge, Shift 10 px, transform-safe reset.
- [ ] Clone ID/reference remapping and view-state restoration.

## Pages and resources

- [ ] Protected pages: Startsida, Om oss, Bokning, Kundens bokningar, Integritetspolicy, Bokningsvillkor.
- [ ] Custom page create/duplicate/rename/delete, SEO, menu visibility, internal links and reserved-route validation.
- [ ] First-class resource library: image + WOFF2 upload, metadata, usage counts, active/archive/trash, immutable replace, protected permanent delete, bulk actions where useful.
- [ ] GrapesJS AssetManager + uploaded fonts integrated with the same inventory.

## KNC domains

- [ ] Business identity/contact/address/map + SEO SV/EN.
- [ ] Global light/dark theme and built-in/uploaded fonts.
- [ ] Barber visible copy/photo, salon gallery, cuts gallery and homepage logo treatment.
- [ ] Privacy/terms both languages with authoritative business/contact/cancellation slots surviving client mount.
- [ ] All existing email families: copy, design/theme, logo picker, preview == delivery representation and failed-delivery panel.
- [ ] Safe runtime/i18n copy with placeholder preservation.
- [ ] Add owner admin tab `Redigering` linking to `/admin/cms/`; keep legacy operational editors.

## Revision safety

- [ ] Undo/redo, Revert, immutable history, inspect and restore-as-draft.
- [ ] Per-tab recoverable backup plus JSON export/import.
- [ ] Failed/unknown Save keeps draft; idempotent retry.
- [ ] Two-tab CAS conflict cannot overwrite silently; independent structured edits merge where safe; page HTML/CSS stays atomic on conflict.
- [ ] Archived assets cannot be introduced into a new placement.

## Verification

- [ ] Unit/integration/type/lint/format/build gates.
- [ ] Booking create + customer access/cancel/review regressions.
- [ ] Chromium desktop, Firefox desktop, WebKit desktop.
- [ ] Real 390×844 Chromium and WebKit studio viewport.
- [ ] Retained screenshots: desktop, mobile, both drawers, Design, Layers, Add, resources, email, history, legal and compare.
- [ ] Explicit o-y-a parity inventory: PORTED / EXTENDED / N/A for every user-facing capability.
- [ ] Adversarial self-review and final CI green.
