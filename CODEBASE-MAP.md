# Codebase map

Start with the area row, then follow its entry file and focused tests. This map describes
source ownership, not production deployment state. Paths are relative to the repository root.
Backend setup and security boundaries live in `BACKEND.md`; local setup lives in `README.md`.

## Areas

| Area                  | Purpose                                                                                                               | Entry file                                                                                                                            | Covering tests                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Browser shell         | Mount, routes, language, theme and responsive layout                                                                  | `src/main.tsx`, `src/app/Root.tsx`, `src/app/App.tsx`                                                                                 | `tests/unit/homepageBoot.test.ts`, `tools/e2e/public-smoke.spec.mjs`                                                                |
| Desktop/mobile layout | Public site composition and mobile folding                                                                            | `src/app/DesktopSite.tsx`, `src/app/MobileSite.tsx`, `src/app/mobileFold.ts`                                                          | `tests/unit/mobileFold.test.ts`, `tools/e2e/visual-stored.spec.mjs`                                                                 |
| Worker                | HTML, metadata, published pages and same-origin customer gateways                                                     | `src/worker.ts`                                                                                                                       | `tests/unit/workerRoutes.test.ts`, `tests/unit/workerCache.test.ts`, `tools/e2e/customer.spec.mjs`                                  |
| Public data           | REST/RPC decoding, catalog cache and Realtime                                                                         | `src/backend/publicRest.ts`, `src/backend/publicRealtime.ts`, `src/booking/adapters/supabaseBookingCatalog.ts`                        | `tests/unit/publicRest.test.ts`, `tests/unit/publicRealtime.test.ts`, `tests/unit/bookingCatalog.test.ts`                           |
| Booking               | Calendar, service selection, details, confirmation and gateway submission                                             | `src/booking/BookingFlow.tsx`, `src/booking/adapters/supabaseBooking.ts`                                                              | `tests/unit/calendar.test.ts`, `tests/unit/publicBookingActionAdapters.test.ts`, `tests/integration/booking.test.ts`                |
| Customer history      | Email links, cookie sessions, cancellation and identity linking                                                       | `src/mybookings/MyBookingsDialog.tsx`, `src/mybookings/customerGateway.ts`                                                            | `tests/unit/customerAccessSecurityContract.test.ts`, `tests/integration/reviews.test.ts`, `tools/e2e/customer.spec.mjs`             |
| About/barbers         | Copy, live roster and animated barber strip                                                                           | `src/about/AboutSection.tsx`, `src/about/useBarberMarquee.ts`                                                                         | `tests/unit/aboutMerge.test.ts`, `tests/unit/barberMarqueeLoop.test.ts`                                                             |
| Gallery/reviews       | Media strip, public reviews and verified submissions                                                                  | `src/about/GalleryMarquee.tsx`, `src/about/reviews/adapters/supabaseReviews.ts`                                                       | `tests/unit/galleryMarqueeAccessibility.test.ts`, `tests/unit/reviewGatewayContract.test.ts`                                        |
| Site identity         | Business settings, SEO, logo, consent and public chrome                                                               | `src/site/business.ts`, `src/site/siteChrome.ts`, `src/site/PrivacyBanner.tsx`                                                        | `tests/unit/businessStructuredData.test.ts`, `tests/unit/siteChrome.test.ts`, `tests/unit/homepageLogo.test.ts`                     |
| Shared UI/copy        | Dialogs, lazy surfaces, styles and translated strings                                                                 | `src/ui/Dialog.tsx`, `src/ui/LazySurface.tsx`, `src/i18n/index.ts`                                                                    | `tests/unit/bookingDialogAccessibility.test.ts`, `tests/unit/lazySurface.test.ts`, `tests/unit/i18n.test.ts`                        |
| Admin session         | Staff login, password recovery and navigation                                                                         | `src/admin/index.tsx`, `src/admin/useAdminSession.ts`                                                                                 | `tests/unit/adminAuth.test.ts`, `tests/unit/adminNavigationState.test.ts`, `tools/e2e/admin-state.spec.mjs`                         |
| Admin bookings        | Listing, creation, cancellation and destructive actions                                                               | `src/admin/views/BookingsView.tsx`, `src/admin/adapters/bookingsAdmin.ts`                                                             | `tests/unit/deleteAdapters.test.ts`, `tests/integration/admin.owner.test.ts`                                                        |
| Admin availability    | Weekly hours, time off, slot blocks and recurring breaks                                                              | `src/admin/views/ScheduleView.tsx`, `src/admin/adapters/schedulesAdmin.ts`                                                            | `tests/unit/availabilityMutationAdapters.test.ts`, `tests/unit/scheduleConflicts.test.ts`, `tools/e2e/admin-schedule.spec.mjs`      |
| Admin catalog         | Barber accounts, roles and per-barber services                                                                        | `src/admin/adapters/barbersAdmin.ts`, `src/admin/adapters/servicesAdmin.ts`                                                           | `tests/unit/barberAccountAdmin.test.ts`, `tests/unit/servicesAdmin.test.ts`, `tests/integration/admin.barber.test.ts`               |
| CMS Studio            | Workspace, draft/history, publication and conflict recovery                                                           | `src/admin/cms/Studio.tsx`, `src/admin/cms/draft.ts`, `src/admin/cms/corePages.ts` (`withCorePages` adoption), `src/admin/cms/api.ts` | `tests/unit/cmsDraft.test.ts`, `tests/unit/cmsMerge.test.ts`, `tools/e2e/cms-conflict.spec.mjs`                                     |
| CMS canvas            | GrapesJS editing, responsive styles and native source capture                                                         | `src/admin/cms/Editor.tsx`, `src/admin/cms/NativeSource.tsx`                                                                          | `tests/unit/cmsResponsiveStyles.test.ts`, `tools/e2e/cms-native.spec.mjs`, `tools/e2e/cms-responsive.spec.mjs`                      |
| CMS resources         | Purpose-aware selection, upload, reuse and lifecycle                                                                  | `src/admin/cms/Resources.tsx`, `shared/cms-resource-assignment.ts`                                                                    | `tests/unit/cmsResourceAssignment.test.ts`, `tests/unit/cmsResourceReplacement.test.ts`, `tools/e2e/cms-resource-workflow.spec.mjs` |
| CMS public runtime    | Project published native content and isolate runtime behavior                                                         | `src/cms/NativeSurface.tsx`, `src/cmsRuntime.tsx`, `src/cms/homepageReplicaPorts.ts`                                                  | `tests/unit/cmsRuntimeSlots.test.ts`, `tests/unit/homepageReplicaPreview.test.ts`, `tools/e2e/cms-projection.spec.mjs`              |
| CMS pages/themes      | Live headers around created-page bodies, core information pages (including /contact), and captured theme declarations | `shared/site-page.ts`, `shared/site-theme-declarations.ts`                                                                            | `tests/unit/cmsSitePage.test.ts`, `tests/unit/cmsCorePages.test.ts`, `tests/unit/cmsDocumentAdoption.test.ts`                       |
| CMS publication       | Shared document validation and owner-authorized persistence                                                           | `shared/cms.ts`, `supabase/functions/cms-studio/index.ts`                                                                             | `tests/unit/cmsSemanticValidation.test.ts`, `tests/integration/cmsPublishConflicts.test.ts`                                         |
| Email                 | One renderer for CMS preview and outgoing messages                                                                    | `shared/email-render.ts`, `src/admin/cms/emailPreview.ts`, `supabase/functions/send-confirmation/index.ts`                            | `tests/unit/cmsEmailPreview.test.ts`, `tests/unit/emailBusiness.test.ts`, `tests/unit/emailDeliveryAdmin.test.ts`                   |
| Email delivery log    | Edge send logging, owner-only failed-delivery actions and the 30-day sent/failed-mail view                            | `supabase/functions/_shared/emailSendLog.ts`, `src/admin/cms/DeliveryStatus.tsx`, `src/admin/adapters/emailDeliveryAdmin.ts`          | `tests/unit/emailSendLog.test.ts`, `tests/unit/emailDeliveryAdmin.test.ts`, `supabase/tests/67_email_send_log_test.sql`             |
| Calendar/outbox       | Durable Calendar, Storage, access-email and Auth actions                                                              | `supabase/functions/_shared/calendar.ts`, `supabase/functions/external-cleanup/index.ts`                                              | `tests/unit/calendarSync.test.ts`, `tests/unit/externalActions.test.ts`, `tests/unit/calendarDeletionOwnership.test.ts`             |
| Media gateway         | Validate uploads and compensate failed Storage operations                                                             | `supabase/functions/upload-image/index.ts`, `src/admin/adapters/mediaGateway.ts`                                                      | `tests/unit/uploadImageRuntime.test.ts`, `tests/unit/imageUploadAdapters.test.ts`                                                   |
| Database              | Schema, RLS, transactional RPCs, triggers and scheduled dispatch                                                      | `supabase/migrations/`, `supabase/tests/`                                                                                             | `tests/integration/`, `supabase/tests/`                                                                                             |
| Verification helpers  | Shared browser routing/CORS and fixtures; fake component hooks                                                        | `tools/e2e/route-api.mjs`, `tools/e2e/builders.mjs`, `tests/unit/helpers/fakeHooks.ts`                                                | `tests/unit/e2eHelpers.test.ts`, `tests/unit/homepageBoot.test.ts`                                                                  |
| CI/release/backup     | Quality gates, artifacts, CMS compatibility and encrypted backups                                                     | `.github/workflows/ci.yml`, `tools/release/cms-release.mjs`, `tools/backup/`                                                          | `tests/unit/cmsRelease.test.ts`, `tests/unit/backupScripts.test.ts`, `tools/ci/`                                                    |

## Common changes — edit in this order

These routes come from code searches, not the old map. Repeat the search when changing a
field: a schema, mapper, renderer and preview may each own a different part of its contract.
Search symbols across src, shared, supabase, tests and tools, including dynamic imports;
these routes identify seams, not a claim that every match needs editing.

### Booking confirmation email field

Search `customer_confirmation` for the template family and `customer_name` for variable flow.
For an existing booking value, follow:

1. `supabase/functions/send-confirmation/index.ts` — actual variables and detail rows.
2. `shared/email-render.ts`, `shared/cms-email.ts` — shared message/HTML rendering if needed.
3. `src/admin/cms/emailPreview.ts` — matching sample data and preview rows.
4. `src/admin/cms/DomainPanels.tsx` — only if an owner-editable template field is added.
5. `tests/unit/cmsEmailPreview.test.ts`, `tests/unit/cmsEmailDesign.test.ts` — renderer/preview parity.

A new stored booking field also needs a forward database migration, request validation and
both gateway adapters. Commercial values remain server-derived; see `BACKEND.md`.

### Barber role label

Search `role_sv` for the wire field and `roleSv` for its public/admin domain mapping.
For copy only, edit through Studio; a code/schema change follows:

1. `shared/cms.ts`, `src/admin/cms/DomainPanels.tsx` — presentation contract and localized inputs.
2. `src/admin/adminSchemas.ts`, `src/admin/types.ts`, `src/admin/adapters/barbersAdmin.ts` — admin mapping.
3. `src/backend/rpcSchemas.ts`, `src/booking/adapters/supabaseBookingCatalog.ts` — public catalog mapping.
4. `src/booking/barbersPort.ts`, `src/about/content/merge.ts`, `src/about/AboutSection.tsx` — public display.
5. `tests/unit/bookingCatalog.test.ts`, `tests/unit/cmsDraftPreview.test.ts` — both mappings.

The presentation role label is separate from the owner/barber authorization role.

### CMS resource purpose/type

Search `ResourcePurpose` and `RESOURCE_PURPOSES` for the shared purpose union and consumers.

1. `shared/cms-resource-assignment.ts`, `shared/cms-resources.ts` — allowed purposes, references and assignment.
2. `src/admin/cms/ResourceDestination.tsx`, `src/admin/cms/Resources.tsx` — picker and upload destination.
3. `src/admin/cms/resourceTargets.ts`, `shared/cms-resource-target.ts` — contextual graphic ownership.
4. `supabase/functions/upload-image/index.ts`, `supabase/functions/cms-studio/index.ts` — server enforcement.
5. `tests/unit/cmsResourceAssignment.test.ts`, `tests/unit/cmsResourceReplacement.test.ts`, `tools/e2e/cms-resource-workflow.spec.mjs` — assignment and lifecycle.

### Barber marquee

Search `useBarberMarquee` and `gaplessLoopFloor` to find the live strip and editor policy.

1. `src/about/useBarberMarquee.ts` — lazy carousel, reduced motion, focus and loop geometry.
2. `src/about/AboutSection.tsx` — strip markup, person cards and hook inputs.
3. `src/admin/cms/editorPolicy.ts` — editor adoption of repeated runtime cards.
4. `tests/unit/barberMarqueeLoop.test.ts`, `tools/e2e/cms-barber-marquee.spec.mjs`, `tools/e2e/visual-stored.spec.mjs` — geometry, editing and pixel guard.

### CMS page or responsive element

1. `shared/cms.ts`, `shared/site-page.ts`, `shared/site-theme-declarations.ts` — page contract, live header and captured theme declarations.
2. `src/admin/cms/corePages.ts` (`withCorePages`), `src/admin/cms/Editor.tsx` — document adoption, page editing and composition.
3. `src/admin/cms/responsiveStyles.ts`, `src/admin/cms/responsiveText.ts` — geometry versus shared text.
4. `src/cms/NativeSurface.tsx`, `src/worker.ts` — public projection versus custom-page rendering.
5. `tests/unit/cmsSitePage.test.ts`, `tools/e2e/cms-responsive.spec.mjs` — publication and fresh reload.

### Availability rule

1. `supabase/migrations/` — new forward migration; database remains authoritative.
2. `src/admin/adapters/schedulesAdmin.ts`, `src/admin/scheduleConflicts.ts` — transactional edits/conflicts.
3. `src/booking/adapters/supabaseBooking.ts`, `src/booking/calendar.ts` — public availability display.
4. `tests/unit/availabilityMutationAdapters.test.ts`, `tests/integration/booking.test.ts`, `supabase/tests/` — rollback, overlap and privilege boundaries.

## Boundaries worth preserving

- Booking rules, prices, permissions and publication validation belong on the server.
- Public routes use the narrow REST/Realtime seams; the full Auth client belongs to admin.
- Shared modules must not import src. CMS Studio must not import admin views.
- Read-only source/preview ports live in `src/cms/homepageReplicaPorts.ts`; their write methods deny submission.
- The booking_calendar_sync_on_change trigger queues Calendar work. The dispatcher owns retry;
  the retired calendar-sync Edge Function is not a current deployment target.
- The Edge senders call `supabase/functions/_shared/emailSendLog.ts`; the Studio reads owner-only
  database RPCs through `src/admin/adapters/emailDeliveryAdmin.ts`. There is no separate log endpoint.
  See `docs/operations/EMAIL_DELIVERY.md` for retention, redaction and rollout.
- Booking mail uses booking_email_delivery_jobs; other external work uses external_action_jobs.
  See `supabase/functions/send-confirmation/README.md` for delivery recovery.
- Homepage changes must preserve the hydrated pixels unless a visual change is explicitly requested.
- PERF-17: ignore the CSP console error from Cloudflare's injected detection script. Never add
  Cache-Control: no-transform: it disables compression (owner decision 31).

## Verification and documentation

- `tests/unit/documentationContracts.test.ts` checks backticked repository paths in this map,
  `README.md`, `src/admin/cms/UX-CONTRACT.md` and `src/admin/cms/DESIGN.md`.
- Unit tests cover pure logic/adapters; integration tests require local Supabase; browser suites
  cover real interaction and pixels. None alone proves production delivery or deployment state.
- `.github/workflows/ci.yml` owns current gates; `docs/CI.md` explains the architecture.
- `docs/operations/CMS_RELEASE.md` owns CMS compatibility/recovery;
  `docs/operations/BACKUP_RESTORE.md` owns encrypted backup/restore.
- `src/admin/cms/UX-CONTRACT.md`, `src/admin/cms/DESIGN.md` and `docs/CMS_PARITY.md`
  retain the editor feature contract. `docs/REVIEW_FINDINGS.md` is archived evidence.
- `docs/REPO_IMPROVEMENT_PLAN.md` retains the owner decisions and historical batch scope.
- Dependency version source: installed npm versions come from `package-lock.json`, not a registry
  lookup. Deno lock scope is `supabase/functions/deno.lock`; shared imports live in
  `supabase/functions/deno.json`, with per-function maps such as `supabase/functions/cms-studio/deno.json`.
- Future tooling, deferred until after handover: knip 6.42.1 and dependency-cruiser 18.7.0,
  exact-pinned if adopted. F3 adds neither dependencies nor configurations for these tools.
- After a field rename or module move, update this map and run its path test. After a backend
  validator change, follow the CMS release guide's compatibility workflow.
