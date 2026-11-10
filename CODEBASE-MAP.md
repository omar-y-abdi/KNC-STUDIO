# Codebase map

Start with the area row, then follow its entry file and focused tests. This map describes
source ownership, not production deployment state. Paths are relative to the repository root.
Backend setup and security boundaries live in `BACKEND.md`; local setup lives in `README.md`.

## Areas

| Area                  | Purpose                                                                                                               | Entry file                                                                                                                                                                                                     | Covering tests                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser shell         | Mount, routes, language, theme and responsive layout                                                                  | `src/main.tsx`, `src/Root.tsx`, `modules/public-web/src/app/App.tsx`                                                                                                                                           | `tests/unit/homepageBoot.test.ts`, `tools/e2e/public-smoke.spec.mjs`                                                                                                                                       |
| Desktop/mobile layout | Public site composition and mobile folding                                                                            | `modules/public-web/src/app/DesktopSite.tsx`, `modules/public-web/src/app/MobileSite.tsx`, `modules/public-web/src/app/mobileFold.ts`                                                                          | `tests/unit/mobileFold.test.ts`, `tools/e2e/visual-stored.spec.mjs`                                                                                                                                        |
| Worker                | HTML, metadata, published pages, generated sitemap and security.txt, and same-origin customer gateways                | `supabase/worker/index.ts`                                                                                                                                                                                     | `tests/unit/workerRoutes.test.ts`, `tests/unit/workerCache.test.ts`, `tests/unit/workerCrawlSurface.test.ts`, `tools/e2e/customer.spec.mjs`                                                                |
| Public data           | REST/RPC decoding, catalog cache and Realtime                                                                         | `modules/public-web/src/backend/publicRest.ts`, `modules/public-web/src/backend/publicRealtime.ts`, `modules/public-web/src/booking/adapters/supabaseBookingCatalog.ts`                                        | `tests/unit/publicRest.test.ts`, `tests/unit/publicRealtime.test.ts`, `tests/unit/bookingCatalog.test.ts`                                                                                                  |
| Booking               | Calendar, service selection, details, confirmation and gateway submission                                             | `modules/public-web/src/booking/BookingFlow.tsx`, `modules/public-web/src/booking/adapters/supabaseBooking.ts`                                                                                                 | `tests/unit/calendar.test.ts`, `tests/unit/publicBookingActionAdapters.test.ts`, `tests/integration/booking.test.ts`                                                                                       |
| Customer history      | Email links, cookie sessions, cancellation and identity linking                                                       | `modules/public-web/src/mybookings/MyBookingsDialog.tsx`, `supabase/worker/customerGateway.ts`                                                                                                                 | `tests/unit/customerAccessSecurityContract.test.ts`, `tests/integration/reviews.test.ts`, `tools/e2e/customer.spec.mjs`                                                                                    |
| About/barbers         | Copy, live roster and animated barber strip                                                                           | `modules/public-web/src/about/AboutSection.tsx`, `modules/public-web/src/about/useBarberMarquee.ts`                                                                                                            | `tests/unit/aboutMerge.test.ts`, `tests/unit/barberMarqueeLoop.test.ts`                                                                                                                                    |
| Gallery/reviews       | Media strip, public reviews and verified submissions                                                                  | `modules/public-web/src/about/GalleryMarquee.tsx`, `modules/public-web/src/about/reviews/adapters/supabaseReviews.ts`                                                                                          | `tests/unit/galleryMarqueeAccessibility.test.ts`, `tests/unit/reviewGatewayContract.test.ts`                                                                                                               |
| Site identity         | Business settings, SEO, logo, raster icons, consent and public chrome                                                 | `modules/public-web/src/site/business.ts`, `modules/public-web/src/site/siteChrome.ts`, `modules/public-web/src/site/PrivacyBanner.tsx`, `tools/brand/render-icons.mjs`                                        | `tests/unit/businessStructuredData.test.ts`, `tests/unit/siteChrome.test.ts`, `tests/unit/homepageLogo.test.ts`, `tests/unit/staticDocuments.test.ts`                                                      |
| Shared UI/copy        | Dialogs, lazy surfaces, styles and translated strings                                                                 | `modules/public-web/src/ui/Dialog.tsx`, `modules/public-web/src/ui/LazySurface.tsx`, `modules/public-web/src/i18n/index.ts`                                                                                    | `tests/unit/bookingDialogAccessibility.test.ts`, `tests/unit/lazySurface.test.ts`, `tests/unit/i18n.test.ts`                                                                                               |
| Admin session         | Staff login, password recovery and navigation                                                                         | `modules/staff-admin/src/index.tsx`, `modules/staff-admin/src/useAdminSession.ts`                                                                                                                              | `tests/unit/adminAuth.test.ts`, `tests/unit/adminNavigationState.test.ts`, `tools/e2e/admin-state.spec.mjs`                                                                                                |
| Admin bookings        | Listing, creation, cancellation and destructive actions                                                               | `modules/staff-admin/src/views/BookingsView.tsx`, `modules/staff-admin/src/adapters/bookingsAdmin.ts`                                                                                                          | `tests/unit/deleteAdapters.test.ts`, `tests/integration/admin.owner.test.ts`                                                                                                                               |
| Admin availability    | Weekly hours, time off, slot blocks and recurring breaks                                                              | `modules/staff-admin/src/views/ScheduleView.tsx`, `modules/staff-admin/src/adapters/schedulesAdmin.ts`                                                                                                         | `tests/unit/availabilityMutationAdapters.test.ts`, `tests/unit/scheduleConflicts.test.ts`, `tools/e2e/admin-schedule.spec.mjs`                                                                             |
| Admin catalog         | Barber accounts, roles and per-barber services                                                                        | `modules/staff-admin/src/adapters/barbersAdmin.ts`, `modules/staff-admin/src/adapters/servicesAdmin.ts`                                                                                                        | `tests/unit/barberAccountAdmin.test.ts`, `tests/unit/servicesAdmin.test.ts`, `tests/integration/admin.barber.test.ts`                                                                                      |
| Admin settings        | Own email and password, cancellation window, review moderation and the admin log                                      | `modules/staff-admin/src/views/SettingsView.tsx`, `modules/staff-admin/src/adapters/reviewsAdmin.ts`, `modules/staff-admin/src/adapters/auditLogAdmin.ts`                                                      | `tests/unit/settingsOwnerLists.test.ts`, `tests/unit/emailChangeForm.test.ts`, `tests/integration/reviewModeration.test.ts`, `supabase/tests/78_review_moderation_test.sql`                                |
| Admin log             | Staff change entries from database triggers and service-role Edge Functions; owner-only read                          | `supabase/migrations/20261110120200_admin_audit_log.sql`, `supabase/functions/_shared/adminAudit.ts`                                                                                                           | `tests/unit/adminAudit.test.ts`, `tests/unit/auditLogAdmin.test.ts`, `supabase/tests/79_admin_audit_log_test.sql`                                                                                          |
| Staff functions       | CORS of the functions the admin panel calls and the password-checked email change                                     | `supabase/functions/_shared/staffCors.ts`, `supabase/functions/send-email-change/index.ts`                                                                                                                     | `tests/unit/staffCorsBoundary.test.ts`, `tests/unit/emailChangeReauth.test.ts`                                                                                                                             |
| CMS Studio            | Workspace, draft/history, publication and conflict recovery                                                           | `modules/studio/src/Studio.tsx`, `modules/studio/src/draft.ts`, `modules/studio/src/corePages.ts` (`withCorePages` adoption), `modules/studio/src/api.ts`                                                      | `tests/unit/cmsDraft.test.ts`, `tests/unit/cmsMerge.test.ts`, `tools/e2e/cms-conflict.spec.mjs`                                                                                                            |
| CMS canvas            | GrapesJS editing, browser-sampled Desktop resize cascade, responsive synchronization and native source capture        | `modules/studio/src/Editor.tsx`, `modules/public-web/src/preview/NativeSource.tsx`, `modules/studio/src/hierarchicalResize.ts`, `modules/studio/src/resizeStyles.ts`, `modules/studio/src/responsiveStyles.ts` | `tests/unit/cmsResponsiveStyles.test.ts`, `tests/unit/cmsHierarchicalResize.test.ts`, `tools/e2e/cms-native.spec.mjs`, `tools/e2e/cms-responsive.spec.mjs`, `tools/e2e/cms-composition-roundtrip.spec.mjs` |
| CMS resources         | Purpose-aware selection, upload, reuse and lifecycle                                                                  | `modules/studio/src/Resources.tsx`, `packages/content-contracts/src/cms-resource-assignment.ts`                                                                                                                | `tests/unit/cmsResourceAssignment.test.ts`, `tests/unit/cmsResourceReplacement.test.ts`, `tools/e2e/cms-resource-workflow.spec.mjs`                                                                        |
| CMS public runtime    | Project published native content and isolate runtime behavior                                                         | `modules/public-web/src/cms/NativeSurface.tsx`, `modules/public-web/src/cmsRuntime.tsx`, `modules/public-web/src/cms/homepageReplicaPorts.ts`                                                                  | `tests/unit/cmsRuntimeSlots.test.ts`, `tests/unit/homepageReplicaPreview.test.ts`, `tools/e2e/cms-projection.spec.mjs`                                                                                     |
| CMS pages/themes      | Live headers around created-page bodies, core information pages (including /contact), and captured theme declarations | `packages/content-contracts/src/site-page.ts`, `packages/content-contracts/src/site-theme-declarations.ts`                                                                                                     | `tests/unit/cmsSitePage.test.ts`, `tests/unit/cmsCorePages.test.ts`, `tests/unit/cmsDocumentAdoption.test.ts`                                                                                              |
| CMS publication       | Shared document validation and owner-authorized persistence                                                           | `packages/content-contracts/src/cms.ts`, `supabase/functions/cms-studio/index.ts`                                                                                                                              | `tests/unit/cmsSemanticValidation.test.ts`, `tests/integration/cmsPublishConflicts.test.ts`                                                                                                                |
| Email                 | One renderer for CMS preview and outgoing messages                                                                    | `packages/content-contracts/src/email-render.ts`, `modules/studio/src/emailPreview.ts`, `supabase/functions/send-confirmation/index.ts`                                                                        | `tests/unit/cmsEmailPreview.test.ts`, `tests/unit/emailBusiness.test.ts`, `tests/unit/emailDeliveryAdmin.test.ts`                                                                                          |
| Email delivery log    | Edge send logging, owner-only failed-delivery actions and the 30-day sent/failed-mail view                            | `supabase/functions/_shared/emailSendLog.ts`, `modules/studio/src/DeliveryStatus.tsx`, `modules/staff-admin/src/adapters/emailDeliveryAdmin.ts`                                                                | `tests/unit/emailSendLog.test.ts`, `tests/unit/emailDeliveryAdmin.test.ts`, `supabase/tests/67_email_send_log_test.sql`                                                                                    |
| Calendar/outbox       | Durable Calendar, Storage, access-email and Auth actions                                                              | `supabase/functions/_shared/calendar.ts`, `supabase/functions/external-cleanup/index.ts`                                                                                                                       | `tests/unit/calendarSync.test.ts`, `tests/unit/externalActions.test.ts`, `tests/unit/calendarDeletionOwnership.test.ts`                                                                                    |
| Media gateway         | Validate uploads and compensate failed Storage operations                                                             | `supabase/functions/upload-image/index.ts`, `modules/staff-admin/src/adapters/mediaGateway.ts`                                                                                                                 | `tests/unit/uploadImageRuntime.test.ts`, `tests/unit/imageUploadAdapters.test.ts`                                                                                                                          |
| Database              | Schema, RLS, transactional RPCs, triggers and scheduled dispatch                                                      | `supabase/migrations/`, `supabase/tests/`                                                                                                                                                                      | `tests/integration/`, `supabase/tests/`                                                                                                                                                                    |
| Data retention        | Nightly booking retention and removal of customer contact data that nothing uses                                      | `supabase/migrations/20261110120400_booking_retention.sql`, `supabase/migrations/20261110120300_orphaned_customer_contact_cleanup.sql`                                                                         | `supabase/tests/81_booking_retention_test.sql`, `supabase/tests/80_orphaned_customer_contact_cleanup_test.sql`                                                                                             |
| Verification helpers  | Shared browser routing/CORS and fixtures; fake component hooks                                                        | `tools/e2e/route-api.mjs`, `tools/e2e/builders.mjs`, `tests/unit/helpers/fakeHooks.ts`                                                                                                                         | `tests/unit/e2eHelpers.test.ts`, `tests/unit/homepageBoot.test.ts`                                                                                                                                         |
| CI/release/backup     | Quality gates, artifacts, CMS compatibility, encrypted backups, the daily live smoke test and Dependabot              | `.github/workflows/ci.yml`, `.github/workflows/live-smoke.yml`, `.github/dependabot.yml`, `tools/smoke-live.mjs`, `tools/release/cms-release.mjs`, `tools/backup/`                                             | `tests/unit/cmsRelease.test.ts`, `tests/unit/backupScripts.test.ts`, `tests/unit/smokeLive.test.ts`, `tools/ci/`                                                                                           |

## Common changes — edit in this order

These routes come from code searches, not the old map. Repeat the search when changing a
field: a schema, mapper, renderer and preview may each own a different part of its contract.
Search symbols across src, shared, supabase, tests and tools, including dynamic imports;
these routes identify seams, not a claim that every match needs editing.

### Booking confirmation email field

Search `customer_confirmation` for the template family and `customer_name` for variable flow.
For an existing booking value, follow:

1. `supabase/functions/send-confirmation/index.ts` — actual variables and detail rows.
2. `packages/content-contracts/src/email-render.ts`, `packages/content-contracts/src/cms-email.ts` — shared message/HTML rendering if needed.
3. `modules/studio/src/emailPreview.ts` — matching sample data and preview rows.
4. `modules/studio/src/DomainPanels.tsx` — only if an owner-editable template field is added.
5. `tests/unit/cmsEmailPreview.test.ts`, `tests/unit/cmsEmailDesign.test.ts` — renderer/preview parity.

A new stored booking field also needs a forward database migration, request validation and
both gateway adapters. Commercial values remain server-derived; see `BACKEND.md`.

### Barber role label

Search `role_sv` for the wire field and `roleSv` for its public/admin domain mapping.
For copy only, edit through Studio; a code/schema change follows:

1. `packages/content-contracts/src/cms.ts`, `modules/studio/src/DomainPanels.tsx` — presentation contract and localized inputs.
2. `modules/staff-admin/src/adminSchemas.ts`, `modules/staff-admin/src/types.ts`, `modules/staff-admin/src/adapters/barbersAdmin.ts` — admin mapping.
3. `packages/backend-contracts/src/rpcSchemas.ts`, `modules/public-web/src/booking/adapters/supabaseBookingCatalog.ts` — public catalog mapping.
4. `modules/public-web/src/booking/barbersPort.ts`, `modules/public-web/src/about/content/merge.ts`, `modules/public-web/src/about/AboutSection.tsx` — public display.
5. `tests/unit/bookingCatalog.test.ts`, `tests/unit/cmsDraftPreview.test.ts` — both mappings.

The presentation role label is separate from the owner/barber authorization role.

### CMS resource purpose/type

Search `ResourcePurpose` and `RESOURCE_PURPOSES` for the shared purpose union and consumers.

1. `packages/content-contracts/src/cms-resource-assignment.ts`, `packages/content-contracts/src/cms-resources.ts` — allowed purposes, references and assignment.
2. `modules/studio/src/ResourceDestination.tsx`, `modules/studio/src/Resources.tsx` — picker and upload destination.
3. `modules/studio/src/resourceTargets.ts`, `packages/content-contracts/src/cms-resource-target.ts` — contextual graphic ownership.
4. `supabase/functions/upload-image/index.ts`, `supabase/functions/cms-studio/index.ts` — server enforcement.
5. `tests/unit/cmsResourceAssignment.test.ts`, `tests/unit/cmsResourceReplacement.test.ts`, `tools/e2e/cms-resource-workflow.spec.mjs` — assignment and lifecycle.

### Barber marquee

Search `useBarberMarquee` and `gaplessLoopFloor` to find the live strip and editor policy.

1. `modules/public-web/src/about/useBarberMarquee.ts` — lazy carousel, reduced motion, focus and loop geometry.
2. `modules/public-web/src/about/AboutSection.tsx` — strip markup, person cards and hook inputs.
3. `modules/studio/src/editorPolicy.ts` — editor adoption of repeated runtime cards.
4. `tests/unit/barberMarqueeLoop.test.ts`, `tools/e2e/cms-barber-marquee.spec.mjs`, `tools/e2e/visual-stored.spec.mjs` — geometry, editing and pixel guard.

### CMS page or responsive element

1. `packages/content-contracts/src/cms.ts`, `packages/content-contracts/src/site-page.ts`, `packages/content-contracts/src/site-theme-declarations.ts` — page contract, live header and captured theme declarations.
2. `modules/studio/src/corePages.ts` (`withCorePages`), `modules/studio/src/Editor.tsx` — document adoption, page editing and composition.
3. `modules/studio/src/responsiveStyles.ts`, `modules/studio/src/responsiveText.ts` — geometry versus shared text.
4. `modules/public-web/src/cms/NativeSurface.tsx`, `supabase/worker/index.ts` — public projection versus custom-page rendering.
5. `tests/unit/cmsSitePage.test.ts`, `tools/e2e/cms-responsive.spec.mjs` — publication and fresh reload.

### Availability rule

1. `supabase/migrations/` — new forward migration; database remains authoritative.
2. `modules/staff-admin/src/adapters/schedulesAdmin.ts`, `modules/staff-admin/src/scheduleConflicts.ts` — transactional edits/conflicts.
3. `modules/public-web/src/booking/adapters/supabaseBooking.ts`, `modules/public-web/src/booking/calendar.ts` — public availability display.
4. `tests/unit/availabilityMutationAdapters.test.ts`, `tests/integration/booking.test.ts`, `supabase/tests/` — rollback, overlap and privilege boundaries.

## Boundaries worth preserving

- Booking rules, prices, permissions and publication validation belong on the server.
- Studio owns page, site/About copy, business/appearance, gallery/logo and email-template publication.
  The schema in `supabase/migrations/` denies authenticated REST content writes and limits direct owner `site_settings` writes to
  `cancellation_policy_hours`. That operational setting stays in `modules/staff-admin/src/views/SettingsView.tsx`
  and outside CMS history/fingerprints.
- Public routes use the narrow REST/Realtime seams; the full Auth client belongs to admin.
- The Worker generates `/sitemap.xml` from the current publication, with `public/sitemap.xml` as
  the fallback when the publication cannot be read, and generates `/.well-known/security.txt`.
  `/my-bookings` is an account page and is served `noindex`.
- The Worker answers with `public/maintenance.html` while `MAINTENANCE` in `wrangler.jsonc` is
  `on`, and with `public/500.html` when handling a request throws; both pages load no script.
- `tools/brand/render-icons.mjs` renders `public/favicon.ico`, `public/apple-touch-icon.png`,
  `public/icons/icon-192.png` and `public/icons/icon-512.png` from `public/favicon.svg`; run it
  again after changing the SVG.
- The functions the admin panel calls from the browser answer CORS through
  `supabase/functions/_shared/staffCors.ts`. Staff changes an Edge Function makes with the service
  role reach the admin log through `supabase/functions/_shared/adminAudit.ts`; see `BACKEND.md`.
- Studio never replaces a stored legal page with the shipped file. `tools/cms/apply-legal-pages.mjs`
  writes a copy of an exported Studio draft whose `/privacy` and `/terms` hold the body and style of
  `public/privacy.html` and `public/terms.html`, for import and publication in Studio.
- Contract packages must not import application implementations. Studio consumes staff's protected
  capabilities through explicit package exports and must not import staff views. Public preview
  owns its renderer; Studio consumes its protocol. `tools/modules/README.md` documents the enforced
  package interfaces and the CI plan.
- Read-only source/preview ports live in `modules/public-web/src/cms/homepageReplicaPorts.ts`; their write methods deny submission.
- The booking_calendar_sync_on_change trigger queues Calendar work. The dispatcher owns retry;
  the retired calendar-sync Edge Function is not a current deployment target.
- The Edge senders call `supabase/functions/_shared/emailSendLog.ts`; the Studio reads owner-only
  database RPCs through `modules/staff-admin/src/adapters/emailDeliveryAdmin.ts`. There is no separate log endpoint.
  See `BACKEND.md` for retention and redaction.
- Booking mail uses booking_email_delivery_jobs; other external work uses external_action_jobs.
  See `supabase/functions/send-confirmation/README.md` for delivery recovery.
- Homepage changes must preserve the hydrated pixels unless a visual change is explicitly requested.
- PERF-17: ignore the CSP console error from Cloudflare's injected detection script. Never add
  Cache-Control: no-transform: it disables compression (owner decision 31).

## Verification and documentation

- `tests/unit/documentationContracts.test.ts` checks backticked repository paths in this map,
  `README.md`, `modules/studio/src/UX-CONTRACT.md` and `modules/studio/src/DESIGN.md`.
- Unit tests cover pure logic/adapters; integration tests require local Supabase; browser suites
  cover real interaction and pixels. None alone proves production delivery or deployment state.
- `.github/workflows/ci.yml` owns current gates; `tools/modules/README.md` explains the
  affected-job plan.
- `.github/workflows/live-smoke.yml` runs `tools/smoke-live.mjs` against production once a day. A
  red "Live site smoke test" run means that a deployed page, a public file, the www redirect or a
  public backend entry point did not answer as that script's header lists, and each `[FAIL]` line
  shows what came back; check 1 also goes red when no barber in the public catalog has a free slot
  3 to 23 days ahead.
- `modules/studio/src/UX-CONTRACT.md` and `modules/studio/src/DESIGN.md` retain the editor
  feature contract.
- Dependency version source: installed npm versions come from `package-lock.json`, not a registry
  lookup. Deno lock scope is `supabase/functions/deno.lock`; shared imports live in
  `supabase/functions/deno.json`, with per-function maps such as `supabase/functions/cms-studio/deno.json`.
  `.github/dependabot.yml` opens weekly update pull requests for npm and for the action pins in
  `.github/workflows/` and `.github/actions/`.
- Future tooling, deferred until after handover: knip 6.42.1 and dependency-cruiser 18.7.0,
  exact-pinned if adopted. F3 adds neither dependencies nor configurations for these tools.
- After a field rename or module move, update this map and run its path test.
