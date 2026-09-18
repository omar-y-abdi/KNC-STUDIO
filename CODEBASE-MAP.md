# CODEBASE-MAP.md

> **Scope of truth:** checked-in repository state for the branch under review. For DB behavior, **later migrations override earlier migrations**. Live state outside git - Supabase Dashboard Database Webhooks, Vault values, deployed secrets, DNS, Resend domain status, Google OAuth config/provider health - must be verified in the platform when relevant.
>
> **Coverage note:** This revision condenses the verified repository map for faster agent navigation while preserving the important ownership, authority, contract, security, test, and operational boundaries.

---

## 1. Agent Operating Contract

### Navigation order

1. Start with **§4 Task / Symptom Router**.
2. Jump to the owning subsystem in **§5 Subsystem Ownership Index**.
3. Identify the **authoritative layer** before editing UI/adapters.
4. Follow the explicit call path, persistence, side effects, and focused verification listed there.
5. Use **§6–§10** for DB/RPC/eventing/config/test/deploy detail.
6. Repository-wide grep is fallback only for symbol-level detail not indexed here or when the code has changed since this map.

### Evidence order

`current implementation + latest applicable migration` → `tests exercising it` → `current runbooks` → `general docs/function READMEs` → `historical reviews`.

Known drift: **§12**.

### Hard invariants - do not violate casually

| Area                 | Invariant                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commercial authority | Booking price/duration/service identity and configured service weekdays are re-resolved from active `public.services`; prices are exact numeric SEK values (maximum two decimals), and browser copies are display/input hints only.                                                                                           |
| Availability         | `available_slots()` is live read authority; write-time authority is `create_booking()` + barber advisory locking + schedule/time-off/one-off/recurring-break checks + confirmed-booking GiST exclusion. A returned slot is not a reservation.                                                                                 |
| Time                 | Business timezone is `Europe/Stockholm`; preserve explicit Stockholm wall-clock conversion across DST.                                                                                                                                                                                                                        |
| Public privilege     | Public mutation/lookup RPCs stay behind `submit-booking` / `public-booking-actions`; do not casually regrant direct anon execution.                                                                                                                                                                                           |
| Customer identity    | Turnstile is bot resistance, not customer authentication. Customer history/cancellation require the current permanent random token delivered to the exact booking email. A fresh email request rotates that address’s token. Verified profile aliases require fresh proof from both mailboxes; phone never authorizes access. |
| Rate limits          | Booking submit (`booking_attempts` + recent `bookings`) and public actions (`public_action_attempts`) are separate systems. Auth email has a third ledger: `auth_email_rate_limits`.                                                                                                                                          |
| Admin auth           | Server/DB authorization is authoritative: Supabase Auth + `public.profiles` + RLS/`SECURITY DEFINER`/Edge checks. UI tab/route gating is UX only.                                                                                                                                                                             |
| Mutation model       | Hybrid writes are intentional: simple owner/barber CRUD may be direct PostgREST+RLS; transactional/sensitive/cross-row operations are RPC/Edge-only. Determine the path before changing grants.                                                                                                                               |
| Media                | Gallery/photo/homepage-logo metadata + Storage lifecycle remain server-coordinated through `upload-image` + internal RPCs + cleanup outbox; do not restore direct browser media writes/deletes.                                                                                                                               |
| Email                | Booking email jobs and 24h reminders are **separate ledgers and dispatchers**. Auth email bypasses both and sends directly through Resend.                                                                                                                                                                                    |
| External actions     | `external_action_jobs` is durable but not universal: Calendar insert/update and cleanup use the outbox; booking mail has its own ledger; auth mail is direct; image upload is synchronous.                                                                                                                                    |
| Calendar             | Durable `booking_calendar_sync_on_change` queues insert/update; outbox handles cancel/delete/disconnect. Retired Dashboard webhook/`calendar-sync` are drift checks only.                                                                                                                                                     |
| Secrets              | Every `VITE_*` value is public. Never move service-role keys, Turnstile secret, OAuth client secret, webhook secret, salts, or Resend key into frontend config.                                                                                                                                                               |
| Schema               | Change DB schema/grants/policies/RPCs through migrations. `btree_gist` lives in `extensions`; `bookings_no_overlap` remains the authoritative GiST exclusion. Evaluate effective state after all later revokes/policy replacements.                                                                                           |
| Discovery            | Public business discovery is explicitly whitelisted; add facts deliberately rather than exposing internal tables.                                                                                                                                                                                                             |
| Supabase clients     | Keep public and admin clients isolated: public `persistSession=false`; admin owns persisted `knc-admin-auth`.                                                                                                                                                                                                                 |
| Tests                | Match evidence to claim. Adapter/unit tests do not prove ImageMagick pixels, third-party provider state, Dashboard webhooks, or other live behavior.                                                                                                                                                                          |
| Deployment           | Live webhooks, Vault values, secrets, OAuth/DNS/domain/provider state are outside git and require operational verification.                                                                                                                                                                                                   |
| Availability edits   | Time-off, slot-block, and recurring-break records are add/delete, not in-place update. Preserve transactional add + RLS-scoped delete unless deliberately redesigning.                                                                                                                                                        |
| Browser integrations | `public/_headers` CSP is part of runtime architecture; new browser origins require CSP/header review.                                                                                                                                                                                                                         |
| Browser privacy      | `src/site/storageConsent.ts` records an explicit first-party storage choice. Customer authorization uses only a server-set HttpOnly session cookie; no phone-memory, analytics, or advertising storage is present.                                                                                                            |
| Domain changes       | `VITE_SITE_URL` alone is not the canonical-origin migration surface; see §9.8.                                                                                                                                                                                                                                                |
| Map upkeep           | Update this map when ownership, important paths, RPC contracts, triggers, grants, runtime/deployment topology, or test authority changes.                                                                                                                                                                                     |

---

## 2. System in 60 Seconds

**Product:** bilingual Swedish/English barbershop booking + admin application.

**Stack:** Preact `10.29.x`; Vite `8.0.x`; TypeScript `6.0.x` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, ES2023); Wouter Preact `3.10.x`; Zod `3.25.x`; Cloudflare Worker + Static Assets; Supabase PostgreSQL/Auth/Storage/Realtime/Edge Functions/pg_cron/pg_net/Vault; Resend; Turnstile; Google OAuth 2.0 + Calendar API v3.

**Dual runtime:** both `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` → live public Supabase adapters. Production build fails without both. Local development without both → deterministic/local public-domain mocks, but named barbers/services/history remain empty rather than pretending to be production data. Admin Calendar has its own mock/live selector, but real OAuth/sync requires Supabase.

```text
Browser
├─ web/assets/SSR metadata → Cloudflare Worker `src/worker.ts`
│  ├─ serves Vite `dist/` via ASSETS
│  ├─ maps random customer-token root paths to `/#booking_token=…`
│  ├─ uncached default entrypoint: www → apex; private/other route policy
│  ├─ cached `PublicContent` entrypoint: apex homepage SEO/JSON-LD + dynamic `/llms.txt`
│  ├─ public HTML aliases; SPA fallback
│  └─ dedicated POST /api/customer-bookings proxy; other Supabase traffic stays direct
└─ direct Supabase traffic
   ├─ PostgREST / Auth / Realtime / SECURITY DEFINER RPCs / Edge Functions
   ├─ bookings → email trigger → booking_email_delivery_jobs → cron → `send-confirmation` → Resend
   ├─ bookings → reminder trigger → booking_reminders → cron → `send-confirmation` → Resend
   ├─ bookings → external_action_jobs → cron → `external-cleanup` → Google Calendar
   └─ cancellation/deletion/storage/auth lifecycle → external_action_jobs → cron → `external-cleanup`
      ├─ Storage
      ├─ Google Calendar
      └─ Auth Admin
```

---

## 3. Repository Topology

| Path                                    | Owns / contains                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/main.tsx`                          | Browser mount; renders `<Root />`.                                                                                       |
| `src/app/`                              | Public shells: `Root.tsx`, `App.tsx`, desktop/mobile hero scroll and booking fold.                                       |
| `src/backend/`                          | Public backend seam: config, lazy public Supabase client, Zod wire schemas, public-action wrapper.                       |
| `src/booking/`                          | Booking domain/UI: wizard, validation, Stockholm time, ICS/calendar links, mock slot packing.                            |
| `src/booking/adapters/`                 | Booking availability plus shared DB-owned barber/photo/service catalog; live Supabase vs empty local/mock adapters.      |
| `src/mybookings/`                       | Permanent customer-link request, appointment history/cancellation, server-backed session/autofill, formatting, adapters. |
| `src/about/`                            | About CMS overlay, gallery, reviews/domain/gateway adapter.                                                              |
| `src/site/`                             | Site chrome/facts, CMS, JSON-LD, Realtime, and browser-storage consent.                                                  |\n| `shared/cms-project.ts`                  | Canonical CMS page HTML/CSS project and trusted functional-island contracts; excludes operational booking/business state. |\n| `shared/cms-markup.ts`                   | Shared safe HTML/CSS/resource validation, including contract-gated runtime hooks for canonical pages.                    |
| `src/admin/`                            | Authenticated admin client/auth lifecycle/shell/domain helpers.                                                          |
| `src/admin/adapters/`                   | Admin booking/schedule/service/barber/CMS/media/email-template data access.                                              |
| `src/admin/calendar/`                   | Calendar connection port/status/adapter/hook/UI.                                                                         |
| `src/admin/views/`                      | Admin tabs: bookings, schedule, services, barbers, site, about, settings, mail, profile.                                 |
| `src/i18n/`                             | SV/EN public/admin strings.                                                                                              |
| `src/ui/`                               | Shared dialog/logo/viewport/font/global-style primitives plus lazy-load boundaries and idle scheduling.                  |
| `src/worker.ts`                         | Uncached hostname/route gateway plus cached public-content entrypoint, assets, metadata, `/llms.txt`, SPA routing.       |
| `public/.well-known/acp.json`           | No file by design; unsupported ACP discovery returns a noindex 404 (discovery + Worker tests).                           |
| `public/google-calendar.html`           | Static Google OAuth verification/privacy page; not linked from the customer homepage.                                    |
| `public/llms.txt`                       | Checked-in machine-readable fallback; Worker renders dynamic `/llms.txt` when discovery succeeds.                        |
| `supabase/migrations/`                  | DB source of truth: schema, RLS/grants, RPCs, triggers, outboxes, cron.                                                  |
| `supabase/functions/`                   | Deno Edge Functions: public gateways, auth mail, Calendar, media, cleanup.                                               |
| `supabase/functions/_shared/`           | Shared email, Calendar API, external-action execution.                                                                   |
| `supabase/tests/`                       | pgTAP schema/RLS/RPC/contract/security tests.                                                                            |
| `tests/unit/`                           | Vitest pure logic, adapters/contracts, scripts, Worker.                                                                  |
| `tests/integration/`                    | Live local-Supabase auth/RLS/RPC/booking/admin/customer flows.                                                           |
| `tools/release/`                        | Public-booking expand/contract rollout validation.                                                                       |
| `tools/backup/`                         | DB/Storage inventory, backup, restore, integrity checks.                                                                 |
| `tools/e2e/`                            | Public smoke plus source-harness admin history/CMS browser regressions.                                                  |
| `tools/visual/`                         | Deterministic captures + pixel compare.                                                                                  |
| `.github/workflows/ci.yml`              | Definitive CI gate.                                                                                                      |
| `.github/workflows/database-backup.yml` | Scheduled encrypted DB + Storage backup.                                                                                 |
| `docs/operations/`                      | Booking-gateway rollout + backup/restore runbooks.                                                                       |

---

## 4. Task / Symptom Router

Use this before broad search. **Start** = likely owner/authority; **Next** = immediate neighbors; **Verify** = minimum focused evidence.

| Task / symptom                                  | Start                                                      | Next                                                                                                                                          | Verify                                                               |
| ----------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Persisted booking price/duration wrong          | current `create_booking()` migration                       | `services`; `supabaseBooking.ts` only if display also differs                                                                                 | `tests/integration/booking.test.ts` + relevant pgTAP                 |
| UI shows wrong service price                    | `BookingFlow.tsx` / `servicesIndex.ts`                     | `supabaseBookingCatalog.ts`, `services`                                                                                                       | pricing/service unit + integration                                   |
| Live customer sees wrong/missing slot           | DB `available_slots()`                                     | `supabaseBooking.ts`; schedules/time-off/blocks                                                                                               | booking integration + pgTAP availability                             |
| Offline/mock slot layout wrong                  | `src/booking/slotPacking.ts`                               | `localCalendar.ts`                                                                                                                            | `slotPacking.test.ts`, `calendar.test.ts`                            |
| Slot visible but submit says taken              | write-time availability                                    | concurrent booking/block; `create_booking()` + GiST                                                                                           | booking integration + pgTAP transactional availability               |
| Booking submit fails                            | `supabase/functions/submit-booking/index.ts`               | `create_booking_with_limits`, `create_booking`, client adapter                                                                                | booking integration + gateway pgTAP                                  |
| Booking challenge rejected                      | Turnstile/gateway                                          | browser site key, `TURNSTILE_SECRET`, `submit-booking`                                                                                        | gateway integration; live function logs if production                |
| Booking rate-limited                            | `create_booking_with_limits()`                             | `booking_attempts`, recent `bookings`, `IP_SALT`                                                                                              | booking gateway DB tests                                             |
| Wrong booking hour/DST                          | `stockholmTime.ts`                                         | DB Stockholm logic in `available_slots` / `create_booking`                                                                                    | `stockholmTime.test.ts` + integration                                |
| Mina bokningar access fails                     | `supabaseMyBookings.ts`                                    | `publicBookingActions.ts`, `public-booking-actions`, permanent token RPCs/table; legacy challenge/session compatibility                       | public-action unit + `39_permanent_customer_booking_access_test.sql` |
| Customer session/autofill                       | session migrations + `src/mybookings/customerGateway.ts`   | Same-origin proxy; HMAC binds IP/origin/body; first-party HttpOnly `SameSite=Lax`; explicit link wins stale cookie; cookies-disabled fallback | gateway contract + browser smoke                                     |
| Secure-link request/review rate-limited         | `consume_public_action_attempt()`                          | `public_action_attempts`, `PUBLIC_ACTION_HASH_SALT`                                                                                           | public gateway/pgTAP rate-limit tests                                |
| Customer cancellation fails                     | `supabaseMyBookings.ts`                                    | public gateway, `cancel_customer_booking_with_access`, `site_settings.cancellation_policy_hours`                                              | public-action unit + `39_permanent_customer_booking_access_test.sql` |
| Review rejected unexpectedly                    | `supabaseReviews.ts`                                       | gateway; empty offline adapter; fake-seed deletion migration                                                                                  | review gateway + integration/pgTAP + mock review unit                |
| Admin login loop                                | `src/admin/auth.ts`                                        | `AdminApp.tsx`, `profiles`, `account_enabled`, admin client storage                                                                           | `adminAuth.test.ts` + auth integration                               |
| Password reset/email-change link fails          | recovery/email-change parser + route                       | matching Edge mail function + Auth config                                                                                                     | recovery/emailChange unit + live config/logs as needed               |
| Admin recovery/email-change mail rate-limited   | `consume_auth_email_send()`                                | `auth_email_rate_limits`                                                                                                                      | auth mail tests + DB state                                           |
| Staff invite/account enable/delete fails        | `barberAccountAdmin.ts`                                    | `admin-create-barber`, `admin-manage-barber`, `profiles`, outbox                                                                              | account unit + admin integration                                     |
| Admin booking grouping wrong                    | `BookingsView.tsx`, `bookingsSections.ts`                  | `weekOfYear.ts`                                                                                                                               | `bookingsSections`, `weekOfYear`                                     |
| Schedule save conflict                          | `schedulesAdmin.ts`, `scheduleConflicts.ts`                | `admin_save_barber_week`                                                                                                                      | `scheduleConflicts`, `availabilityMutationAdapters`, integration     |
| Time-off add fails                              | `timeOffAdmin.ts`                                          | `admin_add_time_off`                                                                                                                          | availability-mutation unit + integration                             |
| Time-off delete fails                           | `timeOffAdmin.ts:deleteTimeOff`                            | final DELETE RLS/grant                                                                                                                        | admin integration + pgTAP RLS                                        |
| Day-grid block add fails                        | `slotBlocksAdmin.ts`                                       | `admin_add_slot_block`                                                                                                                        | availability-mutation unit + pgTAP                                   |
| Day-grid unblock fails                          | direct DELETE in `slotBlocksAdmin.ts`                      | final DELETE RLS/grant                                                                                                                        | admin integration + pgTAP                                            |
| Admin mutation returns `42501`                  | mutation-path classification                               | decide direct-RLS vs RPC-only before policy changes                                                                                           | relevant integration + pgTAP grant/RLS                               |
| Public schedule table 403/empty                 | intentional hardening                                      | use `available_slots()` / discovery instead of anon table read                                                                                | pgTAP anon-read restrictions                                         |
| Barber cannot edit service                      | `servicesAdmin.ts`                                         | services RLS + current profile link                                                                                                           | service validation + barber integration                              |
| Barber delete fails                             | `barbersAdmin.ts` / `admin-manage-barber`                  | `admin_delete_barber`, upcoming bookings, cleanup jobs                                                                                        | `deleteAdapters` + pgTAP delete-barber                               |
| Site text/business/logo stale                   | `supabaseSiteChrome.ts`                                    | `site_content`, `site_settings`, discovery RPC, Realtime publication                                                                          | `siteChrome`, `supabaseSiteChrome`, `publicSite`                     |
| Hydrated UI correct but homepage metadata stale | `src/worker.ts`                                            | Worker `SUPABASE_*`, `business.ts`, discovery RPC/fallback                                                                                    | `workerRoutes`, `businessStructuredData`                             |
| Browser CMS UI stale after update               | `supabaseSiteChromeAdapter.subscribe()`                    | Realtime publication/tables                                                                                                                   | `supabaseSiteChrome` + live Realtime config                          |
| About copy merge wrong                          | `src/about/content/merge.ts`                               | About adapter/admin                                                                                                                           | `aboutMerge.test.ts`                                                 |
| Gallery image missing                           | public gallery adapter                                     | `gallery_images`, Storage object/public URL                                                                                                   | image adapter + pgTAP storage                                        |
| Image/logo upload 413/422/fails                 | `upload-image/index.ts`                                    | media adapter, Storage, internal RPC                                                                                                          | `imageUploadAdapters.test.ts`; real function logs for decode/WASM    |
| Deleted/replaced image remains in Storage       | `external_action_jobs`                                     | `supabase/functions/external-cleanup/index.ts`, `supabase/functions/_shared/externalActions.ts`                                               | externalActions + pgTAP storage outbox                               |
| Confirmation/cancellation email missing         | `booking_email_delivery_jobs`                              | cron → Vault → `send-confirmation` → Resend; failed jobs require owner retry                                                                  | email tests + DB ledger + live provider/logs                         |
| 24h reminder missing                            | `booking_reminders`                                        | eligibility/due → reminder cron → Vault → `send-confirmation`                                                                                 | reminder pgTAP + email tests                                         |
| Email template copy wrong                       | `MailView.tsx`, `emailTemplatesAdmin.ts`                   | `email_template_for_delivery`, `_shared/email.ts`                                                                                             | `emailBusiness` + `28_email_templates_test.sql`                      |
| Calendar connect fails                          | `calendar-oauth-start` / callback                          | state secret, OAuth config, `calendar_store_token`                                                                                            | Calendar unit + function/provider logs                               |
| New/updated booking not in Google               | `booking_calendar_sync_on_change` + `external_action_jobs` | `calendar_sync_source`, `external-cleanup`, token `last_sync_error`                                                                           | `calendarSync` + external-cleanup/function logs                      |
| Cancelled booking remains in Google             | `external_action_jobs`                                     | cleanup executor, `calendar_forget_event`                                                                                                     | `calendarDeletionOwnership` + `externalActions`                      |
| Calendar disconnect stuck                       | `prepare_calendar_disconnect` / tokens                     | mapped events, pending/blocked jobs, `calendar_disconnect` action                                                                             | Calendar/outbox tests + DB state                                     |
| Backup corrupt/fails                            | `.github/workflows/database-backup.yml`                    | `tools/backup/*`, backup runbook                                                                                                              | `backupScripts.test.ts`                                              |
| CI supply-chain/pin failure                     | `.github/workflows/ci.yml`                                 | lockfiles/action SHAs/Deno pin                                                                                                                | `ciSupplyChain.test.ts`                                              |
| DB/integration tests fail only locally          | local stack/env                                            | reproduce CI Supabase start + local function test env; keep integration files serial                                                          | full local pgTAP + integration                                       |
| Worker/private route issue                      | `src/worker.ts`                                            | `Root.tsx`, static aliases                                                                                                                    | `workerRoutes.test.ts` + E2E                                         |

---

## 5. Subsystem Ownership Index

Each block answers: **entry → invocation → authority/state → side effects → constraints → verification**.

### 5.1 Shell, routes, theme, language, Worker routing

| Axis                       | Map                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry/owners               | `src/main.tsx` → `<Root />`; `src/app/Root.tsx`; `src/app/App.tsx`; `src/app/DesktopSite.tsx`; `src/app/MobileSite.tsx`; `src/ui/LazySurface.tsx`; `src/worker.ts`. `App.tsx` owns public theme/lang/view/dialog/metadata-hydration state.                                                                                                                                                                                    |
| Client routes              | `/` → App; booking and Mina bokningar load only on demand; `/login`, `/reset`, `/invite`, `/auth/confirm`, `/admin`, `/admin/*` → lazy admin entry whose auth routes, gate/shell, and uncommon tabs split further; random 64-hex customer paths → App; unknown client route → `NotFound` (no redirect).                                                                                                                       |
| Worker-only route behavior | Uncached default entrypoint performs canonical `www`→apex before cache and delegates only apex `GET /` + `/llms.txt` to cached `PublicContent`; `/privacy` → `privacy.html`; `/terms` → `terms.html`; unknown public routes → branded `404.html` with HTTP 404; `/google-calendar` → `google-calendar.html`; private/auth routes get `X-Robots-Tag: noindex, nofollow`; public handler owns assets + SPA fallback + metadata. |
| State                      | Public UI state is ephemeral in `App.tsx`; no public persisted auth state.                                                                                                                                                                                                                                                                                                                                                    |
| Verify                     | `tests/unit/workerRoutes.test.ts`, `lazySurface.test.ts`, `performanceLifecycle.test.ts`; `npm run test:e2e`; visual regression.                                                                                                                                                                                                                                                                                              |

**Consent:** initial Godkänn/Avvisa and opened preferences are fixed at the viewport bottom across
sections on both desktop/mobile. After choosing, only the hero has the small reopen control; About
has a footer link. `usePrivacyPreferences.ts` owns shared state through layout changes.

### 5.2 Public adapter selection / dual runtime

| Axis                   | Map                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Selector               | `src/backend/config.ts:isBackendConfigured()` requires both public Supabase Vite vars.                                                                                                                                                                                                                                         |
| Public client          | `src/backend/supabaseClient.ts`, lazy, `persistSession:false`; keeps `@supabase/supabase-js` out of initial public chunk until needed.                                                                                                                                                                                         |
| Live/mock selectors    | `src/booking/adapters/index.ts`, `src/booking/adapters/barbersIndex.ts`, `src/booking/adapters/servicesIndex.ts`; `src/about/content/index.ts`; `src/about/gallery/index.ts`; `src/about/reviews/adapters/index.ts`; `src/mybookings/adapters/index.ts`; `src/site/adapters/index.ts`; `src/admin/calendar/adapters/index.ts`. |
| Reviews fallback       | `mockReviewsAdapter` is intentionally empty and refuses submission; only published `reviews` rows are displayed as customer reviews.                                                                                                                                                                                           |
| Mock-only availability | `src/booking/adapters/localCalendar.ts` → `slotPacking.ts`; **live Supabase availability does not use `slotPacking.ts`**.                                                                                                                                                                                                      |
| Calendar selector      | `defaultCalendarSyncPort` picks lazy Supabase adapter when backend is configured, else `mockCalendarSyncPort`; real OAuth/sync remains Supabase-only.                                                                                                                                                                          |

### 5.3 Public booking: UI + live availability + submit

| Axis                        | Map                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI/files                    | `src/booking/BookingFlow.tsx`; `src/booking/DetailsDialog.tsx`; `src/booking/ConfirmationDialog.tsx`; `src/booking/validation.ts`; `src/booking/Turnstile.tsx`; `src/booking/adapters/supabaseBooking.ts`; `src/booking/stockholmTime.ts`; mock `src/booking/adapters/localCalendar.ts` / `src/booking/slotPacking.ts`.                                                                                                                     |
| Catalog read                | `App` idle-preloads `supabaseBookingCatalog.ts` → one `public_booking_catalog()` RPC → active barbers, photo paths, active services, and each service's canonical `available_weekdays`. Roster/service adapters share the TTL/in-flight cache; consumer-owned Realtime starts only while listeners exist, waits for Postgres Changes readiness, then refreshes to close missed-edit gaps. No named barber/service frontend fallback exists. |
| Live read                   | `BookingFlow` filters catalog services by selected local date, then `BookingPort.availability()` → `supabaseBookingAdapter.availability()` → `available_slots_for_service(barber_id,date,service_id)` → `available_slots()` → active barber + working schedule + time off + one-off/recurring breaks + confirmed bookings → ascending `HH:MM`.                                                                                              |
| Submit                      | `BookingFlow` → `supabaseBooking.ts` → same-origin `/api/bookings` → signed Worker relay → `submit-booking` → parse/normalize → Turnstile → SHA-256(trusted `cf-connecting-ip` + `IP_SALT`) → `create_booking_with_limits()` → `create_booking()` → `bookings`.                                                                                                                                                                             |
| Write authority             | `create_booking_with_limits()` migration: `supabase/migrations/20260813115437_transactional_availability_mutations.sql`; availability hardening: `supabase/migrations/20260824074813_recurring_service_availability.sql`. `src/backend/publicBookingActions.ts` proves the optional receipt after the successful submit.                                                                                                                    |
| DB guarantees               | `create_booking_with_limits`: advisory locks on IP/phone scopes; IP ledger `booking_attempts`; phone count from recent `bookings`. `create_booking`: re-resolve active service + weekday, 15-min grid, schedule/time-off/one-off/recurring-break validation, barber availability advisory lock, insert; GiST exclusion rejects confirmed overlap.                                                                                           |
| Commercial/time constraints | Client price/duration/service name are not authority. Selected wall clock is anchored with `localWallClockToStockholmIso()`; DB uses `Europe/Stockholm`.                                                                                                                                                                                                                                                                                    |
| On insert                   | email job trigger; optional reminder row; `booking_calendar_sync_on_change` durable Calendar trigger. Browser shows confirmation + ICS/Google Calendar link.                                                                                                                                                                                                                                                                                |
| Verify                      | `slotPacking.test.ts` only for mock; `stockholmTime.test.ts`; `tests/integration/booking.test.ts`; `supabase/tests/11_booking_gateway_db_test.sql`, `32_transactional_availability_test.sql`, `34_public_booking_gateway_contract_test.sql`; `tests/unit/bookingLinks.test.ts`.                                                                                                                                                             |

**Device access:** `src/mybookings/customerDeviceLock.ts` serializes submit/probe/withdrawal through
one browser Web Lock. `20260910214200_customer_device_booking_receipts.sql` owns hashed receipt
credentials, exact booking-ID grants, fixed expiry, authorized list/cancel, and revocation. A verified
email session only imports grants bound to that verified email; device authority never returns a
verified profile or grants review/linking rights. `_shared/customerCookies.ts` owns the two allowed
cookie names and non-bearer proofs. Worker forwards separate `getSetCookie()` values, filtering out
provider cookies such as `__cf_bm`; never join Set-Cookie headers.

**Challenge:** `_shared/turnstile.ts` is the shared verifier for booking, customer-link request, review
and recovery. Exact configured hostname/action, token length, HTTP success, and8s deadline. Official
test credentials work only with all-loopback configured hosts. `Turnstile.tsx` retries failed script
loads and recreates expired widgets; booking submit waits for a token. See current release runbook.

`BookingFlow.onRosterReady` reports actual initial catalog resolution to `DesktopSite`. The reveal may show loading content, but final geometry settlement waits for roster readiness; later layout changes do not restart that reveal. Booking and review auto-fill replace/clear untouched previous-profile values while preserving explicit typed edits, including empty strings.

### 5.4 Customer self-service: Mina bokningar

**Verified email profiles:** migration `20260913131739_verified_customer_profiles.sql` owns
`customer_profiles`, `customer_profile_emails`, `customer_email_links` and the request/confirm RPCs.
Both mailboxes need fresh proof within 30 minutes, from the exact initiating session. Ordered
profile locks, profile versions and credential generations reject stale/rotated requests; merges
move the whole verified email group atomically. All list/cancel/review operations use that scope;
phone never joins histories and receipt grants stay exact-ID/exact-parent-email scoped.
`CustomerEmailLink.tsx` owns optional management and explicit confirmation; `accessLink.ts` strips
`#email_link` into memory without exchanging credentials. `_shared/customerEmailLink.ts` builds
fixed security mail; `externalActions.ts` delivers encrypted outbox proofs with idempotency.

**Durable dispatch lifetime:** `20260913140731_durable_dispatch_request_budget.sql` gives all three
pg_net dispatchers 30 seconds. `_shared/backgroundTask.ts` retains send-confirmation/external-cleanup
promises with the native hook when present, preserving HTTP outcomes and database-owned retries.
Resend 2xx responses require a UUID before any delivery acknowledgement. Calendar UI polls visible
pending disconnects and refreshes on focus; failed reads preserve known state with manual retry.

| Axis                   | Map                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files                  | `src/mybookings/*`; `src/backend/publicBookingActions.ts`; Worker `customerGateway.ts` + HMAC; Edge `public-booking-actions`.                                                                                                                                                                                                                               |
| Gateway actions        | `request_access`, legacy `exchange_access`, `list`, `cancel`, `review`.                                                                                                                                                                                                                                                                                     |
| Invocation             | email + Turnstile → `request_access` → hash IP/email with `PUBLIC_ACTION_HASH_SALT` → `consume_public_action_attempt()` → `rotate_customer_booking_access_token()` → durable customer-access email with a new random root-path token. Direct link load hashes the token for `list`/`cancel`; legacy one-time links may still exchange into a short session. |
| Identity/state         | Email token is current bearer; Worker proxy signs IP/origin/body with `CUSTOMER_GATEWAY_SECRET`; Edge hashes raw token and sets first-party HttpOnly `SameSite=Lax` session; explicit link wins stale cookie; cookie-only confirmation must match the domain-separated session proof; no phone/browser-storage auth.                                        |
| Cancellation authority | DB `cancel_customer_booking_with_access()` + `site_settings.cancellation_policy_hours`. Cancellation can enqueue `booking_email_delivery_jobs` and, when mapped, `calendar_event_delete` in `external_action_jobs`.                                                                                                                                         |
| Verify                 | `customerAccessToken.test.ts`, `customerAccessSecurityContract.test.ts`, `publicBookingActions.test.ts`, `publicBookingActionAdapters.test.ts`, `mockMyBookings.test.ts`, `39_permanent_customer_booking_access_test.sql`, rollout expand/contract tests.                                                                                                   |

**Current deployment:** `docs/operations/CUSTOMER_ACCESS_REPAIR_2026-09-10.md`. Session mint/rotation locking is migration `20260910130556`; ciphertext repair compares the observed generation in `20260910133329`.

### 5.5 Reviews

| Axis      | Map                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Files     | `src/about/reviewValidation.ts`; `src/about/reviews/domain.ts`, `src/about/reviews/port.ts` (`port.ts`); `src/about/reviews/adapters/supabaseReviews.ts`; public-action wrapper + gateway. |
| Read      | Public client directly SELECTs `reviews` rows permitted by `published = true` policy.                                                                                                      |
| Create    | form → `invokePublicBookingAction({action:'review'})` → Turnstile/rate limit → `create_review_with_access()`.                                                                              |
| Authority | DB verifies completed-booking eligibility and derives/clamps display name server-side.                                                                                                     |
| Verify    | `reviewValidation.test.ts`, `reviewGatewayContract.test.ts`, `tests/integration/reviews.test.ts`, pgTAP review gating.                                                                     |

### 5.6 Admin auth + identity lifecycle

| Axis                      | Map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files                     | `src/admin/adminClient.ts`; `src/admin/auth.ts`; `src/admin/AdminApp.tsx`; `src/admin/passwordPolicy.ts`; `src/admin/recoveryLink.ts`; `src/admin/emailChangeLink.ts` (`emailChangeLink.ts`); `src/admin/ResetPassword*`; `src/admin/InvitePasswordRoute.tsx` (`InvitePasswordRoute.tsx`); `src/admin/EmailChangeConfirm*` (`EmailChangeConfirm*`); Edge: `supabase/functions/send-recovery-email/index.ts`, `supabase/functions/send-email-change/index.ts`, `supabase/functions/admin-create-barber/index.ts`, `supabase/functions/admin-manage-barber/index.ts`. |
| Client isolation          | Public: `persistSession: false`. Admin: `persistSession=true`, `autoRefreshToken=true`, `detectSessionInUrl=false`, `storageKey='knc-admin-auth'`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Authorization authority   | Supabase Auth user + `public.profiles` (`role`, `barber_id`, `account_enabled`, `must_change_password`) + DB/Edge checks.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Password contract         | Minimum 12 chars; no whitespace; ≥1 lowercase, uppercase, digit, symbol matching `[^A-Za-z0-9\s]`; `validateNewPassword()` also requires confirmation equality and, when current password is supplied, rejects reuse. Mirrors `supabase/config.toml`.                                                                                                                                                                                                                                                                                                               |
| Lifecycle                 | Owner provisions through `admin-create-barber`; enable/disable/delete through `admin-manage-barber` + durable Auth sync/delete as required. `set_own_password_changed()` clears forced-change state. Recovery/email-change are branded Edge+Resend flows rate-limited by `consume_auth_email_send()`.                                                                                                                                                                                                                                                               |
| Persistent identity state | Supabase Auth + `profiles`; admin browser session key `knc-admin-auth`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Verify                    | `adminAuth`, `passwordPolicy`, `recoveryLink`, `emailChangeLink`, `barberAccountAdmin`, `barberLinkStatus`; integration `authSecurity` + admin tests.                                                                                                                                                                                                                                                                                                                                                                                                               |

### 5.7 Admin booking operations

| Axis            | Map                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files           | `src/admin/views/BookingsView.tsx`; `src/admin/views/bookingsSections.ts`; `src/admin/weekOfYear.ts`; `src/admin/adapters/bookingsAdmin.ts`.                                          |
| Read            | Authenticated direct SELECT on `bookings`; RLS gives owner/all relevant and barber/own scope.                                                                                         |
| Mutations       | `admin_create_booking()` manual phone/walk-in + transactional availability; `admin_cancel_booking()`; `admin_delete_bookings()` selected history; `admin_purge_history()` owner-only. |
| Authority/state | `bookings`; server RPC authorization/availability for writes.                                                                                                                         |
| Verify          | `bookingsSections.test.ts`, `weekOfYear.test.ts`, `deleteAdapters.test.ts`, admin integration, pgTAP admin booking/delete.                                                            |

**Admin session:** `useAdminSession.ts` owns server role/enabled checks, focus/visibility refresh,
confirmed-revocation clearing, and transient failure handling. `adminClient.ts` binds data requests to
the accepted principal; `auth.ts` isolates password verification/update from the main persisted client.
`adapters/mediaGateway.ts` centralizes upload/delete status mapping.

**Pending admin operations:** `src/admin/orderedOperations.ts` orders reads/writes for the same resource beyond view target changes and remounts. Services/photo use per-barber keys; gallery uses per-kind keys; site settings share one key; booking mutations/readbacks share one key because owner purge/all-bookings overlap barber views. A returning view reads after its earlier write commits before exposing mutable controls. This is ordering inside one browser page, not cross-browser conflict control. DB authorization and existing media CAS remain authoritative. The affected views expose typed adapter ports for the in-memory commit-order browser harness.

### 5.8 Admin availability: weekly schedule, time off, slot blocks, recurring breaks

| Axis             | Map                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files            | `src/admin/views/ScheduleView.tsx`; `src/admin/views/ScheduleDayGrid.tsx`; `src/admin/ReserveDialog.tsx`; `src/admin/time.ts`; `src/admin/scheduleConflicts.ts`; `src/admin/useUnavailabilityConflict.tsx`; `src/admin/adapters/schedulesAdmin.ts`; `src/admin/adapters/timeOffAdmin.ts`; `src/admin/adapters/slotBlocksAdmin.ts`; `src/admin/adapters/recurringBreaksAdmin.ts`. |
| Weekly schedule  | **No direct authenticated write**. `admin_save_barber_week(p_barber_id text, p_week jsonb, p_allow_existing_bookings boolean)`. `p_week` = exactly seven unique objects `{ weekday, working, start_min, end_min }` covering `0..6`.                                                                                                                                              |
| Time off         | ADD through `admin_add_time_off()`; DELETE direct PostgREST+RLS; no UPDATE - edit = delete + add.                                                                                                                                                                                                                                                                                |
| Slot blocks      | ADD through `admin_add_slot_block()`; DELETE direct PostgREST+RLS; immutable/no UPDATE.                                                                                                                                                                                                                                                                                          |
| Recurring breaks | ADD/DELETE through `admin_add_recurring_break()` / `admin_delete_recurring_break()`; 15-minute 09:00–18:00 intervals, no overlapping weekly rows, and covered day-grid quarters are inert.                                                                                                                                                                                       |
| Constraints      | Transactional save/add detects confirmed-booking conflicts and supports `p_allow_existing_bookings` where applicable; uses availability locking pattern. Anon direct SELECT of schedule tables is removed; public availability uses definer RPCs.                                                                                                                                |
| Manual booking   | `ReserveDialog` accepts blank price as the intentional default, preserves zero/decimal prices, and blocks non-empty values outside the dot-decimal price contract before calling `admin_create_booking()`.                                                                                                                                                                       |
| State            | `barber_schedules`, `barber_time_off`, `barber_slot_blocks`, `barber_recurring_breaks`.                                                                                                                                                                                                                                                                                          |
| Verify           | `adminTime`, `scheduleConflicts`, `availabilityMutationAdapters`, admin integration; pgTAP `15_restrict_anon_schedule_reads`, `32_transactional_availability`, `36_recurring_service_availability`.                                                                                                                                                                              |

### 5.9 Barbers + services administration

| Axis     | Map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files    | `src/admin/views/BarbersView.tsx`; `src/admin/views/ServicesView.tsx`; `src/admin/adapters/barbersAdmin.ts`; `src/admin/adapters/servicesAdmin.ts`; `src/admin/serviceValidation.ts`.                                                                                                                                                                                                                                                                                                                |
| Barbers  | Public reads active. Owner create/update = direct PostgREST+owner RLS. Authenticated direct DELETE revoked; delete goes via `admin-manage-barber` → `admin_delete_barber()` for upcoming-booking guard + cleanup coordination.                                                                                                                                                                                                                                                                       |
| Services | Public reads active. Owner and linked barber read through RLS; ordinary edits use permitted direct PostgREST fields and cannot alter `sort_order`. Create, delete, and reorder use authorized per-barber RPCs with an advisory lock, unique constraint, and zero-based contiguous compaction. Prices are exact `numeric` SEK values with at most two decimals; duration input is normalized to whole minutes before persistence. Booking insertion always re-resolves service authority server-side. |
| State    | `barbers`, `services`, linked `profiles`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Verify   | `serviceValidation`, `servicesAdmin`, `services.ordering` integration, `deleteAdapters`, `barberLinkStatus`, owner/barber integration, pgTAP services/order/delete-barber.                                                                                                                                                                                                                                                                                                                           |

### 5.10 Site CMS + About CMS + discovery + SEO

| Axis              | Map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files             | `src/site/business.ts` (schema.org `HairSalon` JSON-LD); `src/site/siteChrome.ts`; `src/site/useSiteChrome.ts`; `src/site/adapters/supabaseSiteChrome.ts`; `src/about/content/*`; admin `src/admin/views/SiteView.tsx`, `src/admin/views/HomepageReplicaPreview.tsx`, `src/admin/views/AboutView.tsx`, `src/admin/adapters/siteAdmin.ts`, `src/admin/adapters/aboutAdmin.ts`; `src/worker.ts`; `public/google-calendar.html`; `public/llms.txt`; RPC `public_business_discovery()`. |
| Data              | `site_content` public copy by key/lang; `site_settings` business/cancellation/SEO/scales; `about_content` About overlay; `public_business_discovery()` returns only whitelisted business facts + active barbers + active service prices + working schedules.                                                                                                                                                                                                                        |
| Wire contract     | `src/backend/rpcSchemas.ts:publicBusinessDiscoveryResponse` → `{ settings: Record<string,string>, barbers:[{id,name}], services:[{id,barber_id,price}], schedules:[{barber_id,weekday,start_min,end_min}] }`; weekday `0..6`, `start_min 0..1439`, `end_min 1..1440`.                                                                                                                                                                                                               |
| Browser hydration | Initial `site_content` + discovery reads use direct Data API fetches, keeping `supabase-js` off the critical path; About content/roster/gallery/reviews/Turnstile wait until About intersects.                                                                                                                                                                                                                                                                                      |
| Realtime          | `useSiteChrome()` starts `supabaseSiteChromeAdapter.subscribe()` during idle time only while the tab is visible, disconnects while hidden, and revalidates before resubscribing. Subscription dynamically imports `supabase-js`, waits for Postgres Changes readiness, then watches `site_content`, `site_settings`, `barbers`, `services`, `barber_schedules`.                                                                                                                     |
| Machine discovery | Unsupported ACP discovery has no checked-in manifest and returns a noindex 404. `/llms.txt` is dynamic when discovery succeeds, else checked-in fallback. `loadDiscovery()` abort/fallback after 1800 ms; dynamic `/llms.txt` cache 300 s.                                                                                                                                                                                                                                          |
| Worker            | Cached `PublicContent` server-loads discovery for Swedish homepage metadata/JSON-LD + `/llms.txt`; homepage uses `max-age=60, s-maxage=300` only after successful discovery and `no-store` for checked-in fallback. Host canonicalization stays in uncached default entrypoint.                                                                                                                                                                                                     |
| Verify            | `siteChrome`, `homepageLogo`, `homepageReplicaPreview`, `businessStructuredData`, `supabaseSiteChrome`, `aboutMerge`, `performanceLifecycle`, `workerRoutes`, `discovery`, `publicSite` integration, `npm run test:e2e`, and `npm run test:e2e:admin`.                                                                                                                                                                                                                              |

**`public_business_discovery().settings` SQL whitelist - adding a `site_settings` row alone is insufficient:**

```text
homepage_scale
about_scale
homepage_logo_path
homepage_logo_scale
homepage_logo_style
business_name
business_legal_name
business_org_number
business_email
business_phone_display
business_phone_tel
business_street
business_postal_code
business_city
business_maps_href
cancellation_policy_hours
seo_title_sv
seo_description_sv
seo_title_en
seo_description_en
```

**Legal pages:** `/terms` and `/privacy` load the same discovery settings on every GET and render company identity, contacts and cancellation timing into HTML. Responses use `no-store`; failed discovery leaves generic copy without stale company/contact assertions. `business_legal_name` and `business_org_number` start blank, are validated by the existing settings trigger and owner RLS, and appear in JSON-LD only when set. The salon owner supplies these in SiteView; empty legal fields are omitted publicly.

If Worker/email/machine-discovery code needs a new mutable fact, update the SQL whitelist **and** wire consumer/schema deliberately.

### 5.11 Media / secure image processing

**Public gallery:** `gallery/supabaseGallery.ts` rejects failed reads; `gallery/useGallery.ts` exposes loading/ready/error and discards stale responses. About displays noninteractive loading/empty/unavailable text; `GalleryMarquee` renders only published photos and falls back from blank CMS alt to localized labels. Loop clones remain hidden/nonfocusable; missing barber portraits are decorative neutral icons beside their visible names.

| Axis                | Map                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files               | admin `src/admin/views/AboutView.tsx`, `src/admin/views/ProfileView.tsx`, `src/admin/views/SiteView.tsx`; adapters `galleryAdmin.ts`, `barberPhotoAdmin.ts`, `homepageLogoAdmin.ts`; public `src/site/HomepageLogo.tsx`; `supabase/functions/upload-image/index.ts`; `magick.wasm`.                                                                       |
| Write path          | Authenticated browser does **not** directly mutate `gallery_images` / `barber_photos` or homepage-logo bytes. UI → `upload-image` → role/profile authorization → lazy ImageMagick/WASM initialization for multipart uploads only → decode/validate/process → Storage upload → internal metadata RPC → old-object cleanup enqueue when replacing/deleting. |
| Input/output limits | decoded formats JPEG/PNG/WEBP/AVIF/HEIC/HEIF; max input 5 MiB; max decoded pixels 25,000,000; gallery long side ≤1600 px; profile centered 800×800 crop; WebP target ≤512,000 bytes; quality 82 decreasing by 3 to floor 55; strip metadata when WASM exposes `strip()`.                                                                                  |
| Storage/state       | Buckets `gallery`, `barber-photos`; rows `gallery_images`, `barber_photos`, plus `site_settings.homepage_logo_path`; replaced/deleted objects go to `external_action_jobs`. Logo objects use `gallery/logo/<uuid>.webp`.                                                                                                                                  |
| RPCs                | `internal_insert_gallery_image`, `internal_delete_gallery_image`, `internal_replace_barber_photo`, `internal_delete_barber_photo`, `internal_replace_homepage_logo`, `internal_remove_homepage_logo`, `internal_queue_storage_deletion`.                                                                                                                  |
| Verify              | `imageUploadAdapters.test.ts`, `uploadImageDependency.test.ts`, `uploadImageRuntime.test.ts`, `39_admin_homepage_logo_cms_test.sql` + pgTAP secure image/storage tests. Runtime test decodes JPEG, copies callback-owned output bytes, and checks the 800×800 profile result; live deployment smoke remains authoritative for hosted bundling.            |

### 5.12 Booking email + reminders + auth mail

| Path                      | Chain / authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation/cancellation | booking INSERT/status → triggers `booking_email_delivery_on_insert` / `_on_status_change` → `queue_booking_email_delivery()` → `booking_email_delivery_jobs` → per-minute `booking-email-delivery-dispatch` → `queue_due_booking_email_deliveries()` → Vault `booking_confirmation_url` + `booking_webhook_secret` → pg_net POST `send-confirmation` → `booking_email_delivery_for_dispatch()` → `booking_confirmation_details()` → `email_template_for_delivery()` → Resend → `mark_booking_email_delivery_recipient()` → complete/fail. |
| 24h reminder              | eligible booking INSERT → `booking_reminder_on_insert` → `booking_reminders` → per-minute `booking-reminder-dispatch` → `queue_due_booking_reminders()` → same Vault URL/secret → `send-confirmation(event=reminder)` → Resend customer → `mark_booking_reminder_delivered()`.                                                                                                                                                                                                                                                            |
| Auth mail                 | Recovery + email-change Edge Functions send directly through Resend and rate-limit through `auth_email_rate_limits` / `consume_auth_email_send()`; **not** booking outbox.                                                                                                                                                                                                                                                                                                                                                                |

**Reminder rules:** row created only when booking was made ≥24h before `start_at`; `due_at = start_at - 24 hours`; failed/unconfirmed attempts requeue no more often than every 5 min; stop dispatch once appointment is ≤23h away; max 50 due rows/dispatcher call using `FOR UPDATE ... SKIP LOCKED`.

**Idempotency:** `send-confirmation` uses deterministic scope/kind/booking identifiers and durable per-recipient acknowledgement for booking-email jobs.

**Files/tests:** `supabase/functions/_shared/email.ts`; `supabase/functions/send-confirmation/index.ts`; `supabase/functions/send-recovery-email/index.ts`; `supabase/functions/send-email-change/index.ts`; migrations `20260809175549_booking_reminders.sql`, `20260813095925_durable_booking_email_delivery.sql`; tests `emailBusiness.test.ts`, `webhookSecretContract.test.ts`, pgTAP booking-reminder/email-delivery.

### 5.13 Email-template administration

| Axis          | Map                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files/state   | `src/admin/views/MailView.tsx`; `src/admin/adapters/emailTemplatesAdmin.ts`; `supabase/functions/_shared/email.ts`; `public.email_templates`. Exact table shape: `public.email_templates(template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead, updated_at)`. Owner-auth direct CRUD via PostgREST+RLS; server reads via `email_template_for_delivery()` with code defaults as fallback where appropriate. |
| Table         | `(template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead, updated_at)`; `section_title`, `contact_lead` nullable. Limits: subject/title/section title ≤120; preheader ≤180; intro/note ≤800; CTA ≤80; contact lead ≤240; non-null text min length 1.                                                                                                                                                        |
| Interpolation | `_shared/email.ts` replaces supplied `{lower_snake_case}` variables; unknown tokens remain unchanged. Treat `MailView` registry + sender-provided variables as the supported editing contract.                                                                                                                                                                                                                                                      |
| Contact CMS   | Mail and Startsida share `business_phone_display`, `business_phone_tel`, `business_maps_href`. Blank or malformed phone/map values are omitted server-side from text/HTML rather than falling back to stale data; only HTTPS map URLs and normalized `tel:` values render.                                                                                                                                                                          |
| Verify        | `emailBusiness.test.ts`; pgTAP `28_email_templates_test.sql`.                                                                                                                                                                                                                                                                                                                                                                                       |

| Template                | Languages | Editor-supported placeholders                                                             |
| ----------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `customer_confirmation` | SV, EN    | `{business_name}`, `{customer_name}`, `{barber_name}`, `{cancellation_hours}`             |
| `barber_confirmation`   | SV        | `{business_name}`, `{customer_name}`, `{barber_name}`, `{booking_date}`, `{booking_time}` |
| `customer_cancellation` | SV, EN    | `{business_name}`, `{customer_name}`, `{barber_name}`                                     |
| `barber_cancellation`   | SV        | `{business_name}`, `{customer_name}`, `{barber_name}`, `{booking_date}`, `{booking_time}` |
| `customer_reminder`     | SV, EN    | `{business_name}`, `{customer_name}`, `{barber_name}`, `{cancellation_hours}`             |
| `auth_recovery`         | SV, EN    | `{business_name}`                                                                         |
| `auth_email_change`     | SV, EN    | `{business_name}`, `{new_email}`                                                          |
| `auth_invite`           | SV, EN    | `{business_name}`                                                                         |

### 5.14 Google Calendar synchronization

| Path                | Chain / authority                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files/state         | Calendar UI + `supabase/functions/_shared/calendar.ts`; Edge OAuth, disconnect, `external-cleanup`; `barber_calendar_tokens`, `calendar_event_map`.                                                                                                                                                                                                                                                                    |
| Connect             | authenticated barber → OAuth start → signed HMAC state (`CALENDAR_STATE_SECRET`) → Google consent → callback → verify state + active linked barber → code exchange → `calendar_store_token()` → queue future confirmed bookings through `calendar_backfill_source()`. The durable worker owns backfill ordering, including old-map cleanup after an unlinked destination later connects.                               |
| Insert/update       | durable trigger → identifier-only outbox job → `external-cleanup` → authoritative source re-read → Google insert/patch.                                                                                                                                                                                                                                                                                                |
| Cancel/delete       | DB trigger → deduplicated `calendar_event_delete` in `external_action_jobs` with an identifier-only barber/calendar/event snapshot → `external-cleanup` → Google delete using the old barber's current server credential → `calendar_forget_event_if_matches()`.                                                                                                                                                       |
| Disconnect          | `prepare_calendar_disconnect()` marks pending, queues mapped deletions, then `calendar_disconnect`; executor revokes Google token and deletes token state after cleanup.                                                                                                                                                                                                                                               |
| Repair              | `calendar_authorization_owner_for_job()` assigns authorization recovery to the credential the worker actually attempted: a stale-map sync belongs to the old mapped barber, otherwise to the target barber. `calendar_connection_status()` and `calendar_store_token()` share that predicate; the UI prioritizes same-account reauthorization even while connected, and OAuth/store reject a missing account identity. |
| External dependency | Google provider state is outside git; retired Dashboard webhook/`calendar-sync` must be absent live.                                                                                                                                                                                                                                                                                                                   |
| Verify              | `calendarSync.test.ts`, `calendarDeletionOwnership.test.ts`, `externalActions.test.ts`, `47_calendar_customer_contact_test.sql`, `49_calendar_reassignment_test.sql`, pgTAP Calendar tests + live webhook/function/provider logs.                                                                                                                                                                                      |

### 5.15 Durable external-actions outbox

| Axis           | Map                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files/state    | `supabase/functions/_shared/externalActions.ts`; `supabase/functions/external-cleanup/index.ts`; migrations `supabase/migrations/20260813115438_durable_storage_cleanup.sql` and `20260902005645_calendar_reassignment_cleanup.sql`; `external_action_jobs`.                              |
| Action types   | `storage_object_delete`, `calendar_event_sync`, `calendar_event_delete`, `calendar_disconnect`, `auth_user_access_sync`, `auth_user_delete`.                                                                                                                                              |
| Dispatch       | per-minute `external-action-dispatch` → `queue_due_external_actions()` → Vault `external_cleanup_url` + `booking_webhook_secret` → `external-cleanup` → `external_action_for_dispatch()` → execute → `complete_external_action()` / `fail_external_action()` / `block_external_action()`. |
| Extra behavior | `queue_due_external_actions()` runs orphaned-storage detection before due-job dispatch.                                                                                                                                                                                                   |
| Scope          | Not used for booking mail, auth mail, or synchronous image upload.                                                                                                                                                                                                                        |

### 5.16 High-value dependency direction

```text
UI / orchestration
  → port/seam modules
    → concrete adapter (mock/local or Supabase)
      → public/admin Supabase client
        → RPC / PostgREST / Edge Function
          → server / DB authority

Pure leaves (validation, time/math/formatting/link parsing) should not depend on UI/network adapters.
```

Key relationships:

```text
BookingFlow.tsx
├─ BookingPort + roster/services + dialogs
├─ validation.ts / DetailsDialog.tsx
├─ Turnstile.tsx
├─ live: adapters/index.ts → supabaseBooking.ts
└─ mock: adapters/index.ts → localCalendar.ts → slotPacking.ts

supabaseBooking.ts
├─ availability → available_slots
├─ submit → submit-booking
├─ time → stockholmTime.ts
├─ wire parsing → src/backend/rpcSchemas.ts
└─ success links → localCalendar.ts:buildLinks   # shared link builder, not live-slot authority

publicBookingActions.ts
├─ supabaseMyBookings.ts
├─ supabaseReviews.ts
└─ invokes only public-booking-actions

submit-booking → create_booking_with_limits → create_booking → bookings → triggers/webhook

send-confirmation
├─ booking_email_delivery_for_dispatch
├─ booking_confirmation_details
├─ email_template_for_delivery / _shared/email.ts
├─ Resend
├─ mark_booking_email_delivery_recipient
└─ complete/fail booking job OR mark reminder delivered

external-cleanup
├─ durable `booking_calendar_sync_on_change` trigger + `external_action_jobs`
├─ x-webhook-secret
├─ calendar_sync_source (execution-time authoritative booking re-read)
├─ _shared/calendar.ts
└─ calendar_record_event / calendar_record_error

upload-image
├─ auth/profile authorization
├─ ImageMagick WASM
├─ Storage upload
├─ internal media RPC
└─ durable old-object cleanup

ScheduleView.tsx
├─ schedulesAdmin.ts
├─ scheduleConflicts.ts
├─ useUnavailabilityConflict.tsx
└─ ScheduleDayGrid.tsx
```

**Purity expectations:** keep `slotPacking.ts`, `validation.ts`, `stockholmTime.ts`, `scheduleConflicts.ts`, formatters, and link parsers free of network/UI side effects unless their explicit responsibility changes.

---

## 6. Database, RPC, Trigger, Cron, and State Map

### 6.1 Effective `public` table access - 25 tables

Effective state is after **all** migrations, not original grants.

| Table                                | Key                    | Direct client access                                              | Authoritative mutation path                                           |
| ------------------------------------ | ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `about_content`                      | `(key, lang)`          | anon/auth SELECT; owner-auth direct writes via RLS                | `aboutAdmin.ts` direct PostgREST CRUD                                 |
| `auth_email_rate_limits`             | `(kind, scope_hash)`   | no normal client table access                                     | `consume_auth_email_send()`                                           |
| `barber_calendar_tokens`             | `barber_id`            | no browser table access                                           | Calendar SECURITY DEFINER RPCs / server functions                     |
| `barber_photos`                      | `barber_id`            | anon/auth SELECT                                                  | `upload-image` → internal replace/delete photo RPC                    |
| `barber_schedules`                   | `(barber_id, weekday)` | authenticated SELECT only; anon SELECT removed                    | `admin_save_barber_week()`                                            |
| `barber_slot_blocks`                 | `id`                   | authenticated SELECT; authenticated RLS-scoped DELETE             | add `admin_add_slot_block()`; delete `slotBlocksAdmin.ts` direct RLS  |
| `barber_time_off`                    | `id`                   | authenticated SELECT; authenticated RLS-scoped DELETE             | add `admin_add_time_off()`; delete `timeOffAdmin.ts` direct RLS       |
| `barbers`                            | `id`                   | anon active SELECT; authenticated SELECT per policies             | owner direct create/update RLS; delete `admin_delete_barber()`        |
| `booking_attempts`                   | bigint PK              | none                                                              | `create_booking_with_limits()` IP ledger                              |
| `booking_email_delivery_jobs`        | `id`                   | direct table access revoked from API roles including service_role | trigger + dedicated SECURITY DEFINER delivery RPCs                    |
| `customer_booking_access_challenges` | `id`                   | no API table access                                               | token rotation / one-time exchange RPCs                               |
| `customer_booking_access_sessions`   | `id`                   | no API table access                                               | service-role scoped list/cancel RPCs                                  |
| `customer_booking_access_tokens`     | normalized `email`     | no API table access                                               | confirmation ensure/repair + customer-request rotation RPCs           |
| `booking_reminders`                  | `booking_id`           | direct access revoked from anon/auth/service_role                 | trigger/cron + reminder RPCs                                          |
| `bookings`                           | `id`                   | anon none; authenticated SELECT under owner/barber RLS            | public/admin booking RPCs only                                        |
| `calendar_event_map`                 | `booking_id`           | no browser table access                                           | Calendar RPCs / external cleanup                                      |
| `email_templates`                    | `(template, lang)`     | owner-auth direct CRUD via RLS                                    | `emailTemplatesAdmin.ts`; server read `email_template_for_delivery()` |
| `external_action_jobs`               | `id`                   | direct table access locked down                                   | triggers/internal queue RPCs + cleanup RPCs                           |
| `gallery_images`                     | `id`                   | anon/auth SELECT                                                  | `upload-image` internal RPCs                                          |
| `profiles`                           | Auth user `id`         | self SELECT; owner SELECT-all                                     | provisioning/account RPC/Edge flows; no generic browser CRUD          |
| `public_action_attempts`             | bigint identity        | none                                                              | `consume_public_action_attempt()`                                     |
| `reviews`                            | `id`                   | anon/auth SELECT only `published=true`                            | `create_review_with_access()` via public gateway                      |
| `services`                           | `id`                   | anon active SELECT; authenticated owner/own SELECT                | reads + ordinary edits via RLS; create/delete/reorder service RPCs    |
| `site_content`                       | `(key, lang)`          | anon/auth SELECT                                                  | owner direct CRUD via RLS                                             |
| `site_settings`                      | `key`                  | anon/auth SELECT                                                  | owner direct CRUD via RLS                                             |

**Relational invariants:** confirmed bookings cannot overlap for one barber because of GiST exclusion on `[start_at,end_at)`; `create_booking()` additionally serializes availability-sensitive writes with barber advisory lock and rechecks schedule/time-off/blocks. `bookings.service_id` is text to preserve references across service schema evolution; current creation resolves active `services.id` by text representation. Current booking methods: `phone`, `email`, `walkin` (earlier `sms` naming migrated away).

### 6.2 Public/application RPCs

| Function                                | Caller                                | Authority / purpose                                                   | Latest defining migration                                    |
| --------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `available_slots`                       | public/admin adapters                 | live bookable starts                                                  | `20260824074813_recurring_service_availability.sql`          |
| `create_booking`                        | booking gateway/service role          | service re-resolution + slot validation + insert                      | `20260824074813_recurring_service_availability.sql`          |
| `create_booking_with_limits`            | `submit-booking`                      | transactional submit rate limit + create                              | `20260813115437_transactional_availability_mutations.sql`    |
| `exchange_customer_booking_access`      | `public-booking-actions` service role | one-time code to opaque session exchange                              | `20260905154608_customer_http_only_session.sql`              |
| `ensure_customer_booking_access_token`  | `send-confirmation` service role      | create/reuse permanent token for confirmation mail                    | `20260824075454_permanent_customer_booking_access.sql`       |
| `establish_customer_booking_session`    | `public-booking-actions` service role | current permanent hash to revocable session; serialized with rotation | `20260910130556_serialize_customer_access_sessions.sql`      |
| `replace_customer_booking_access_token` | `send-confirmation` service role      | repair only the observed generation; reload concurrent winner         | `20260910133329_guard_customer_token_repair.sql`             |
| `rotate_customer_booking_access_token`  | `public-booking-actions` service role | email-only token rotation + durable email enqueue                     | `20260910130556_serialize_customer_access_sessions.sql`      |
| `list_customer_bookings_with_access`    | `public-booking-actions` service role | current permanent token or legacy session history                     | `20260910130556_serialize_customer_access_sessions.sql`      |
| `cancel_customer_booking_with_access`   | `public-booking-actions` service role | current permanent token or legacy session + cutoff                    | `20260824075454_permanent_customer_booking_access.sql`       |
| `create_review_with_access`             | `public-booking-actions` service role | completed-booking review gate                                         | `20260823174500_close_launch_review_findings.sql`            |
| `public_booking_catalog`                | public booking adapters               | active barber/photo/service catalog plus canonical weekdays           | `20260824092548_public_booking_catalog_service_weekdays.sql` |
| `public_business_discovery`             | Worker/public site/server email       | whitelisted business facts                                            | `20260824075236_admin_cms_logo_and_contact_controls.sql`     |

After contract migration, direct anon execution of customer mutation/lookup RPCs is revoked; gateways retain service-role access. `available_slots()` and discovery remain public read RPCs.

### 6.3 Admin transactional RPCs

| Function                           | Caller                | Purpose                                           |
| ---------------------------------- | --------------------- | ------------------------------------------------- |
| `admin_create_booking`             | `bookingsAdmin.ts`    | authorized manual booking + availability checks   |
| `admin_cancel_booking`             | `bookingsAdmin.ts`    | authorized cancellation                           |
| `admin_delete_bookings`            | `bookingsAdmin.ts`    | selected history deletion                         |
| `admin_purge_history`              | `bookingsAdmin.ts`    | owner-only purge                                  |
| `admin_save_barber_week`           | `schedulesAdmin.ts`   | atomic week save + conflict result                |
| `admin_add_time_off`               | `timeOffAdmin.ts`     | atomic time-off add + conflict result             |
| `admin_add_slot_block`             | `slotBlocksAdmin.ts`  | atomic block add + conflict result                |
| `admin_create_service`             | `servicesAdmin.ts`    | authorized append at the next per-barber position |
| `admin_delete_service`             | `servicesAdmin.ts`    | authorized delete + per-barber compaction         |
| `admin_reorder_service`            | `servicesAdmin.ts`    | authorized atomic one-position reorder            |
| `admin_delete_barber`              | `admin-manage-barber` | guarded deletion + cleanup orchestration          |
| `admin_set_barber_account_enabled` | `admin-manage-barber` | account flag + durable Auth sync                  |
| `set_own_password_changed`         | `src/admin/auth.ts`   | clear caller forced-change flag                   |

### 6.4 Rate-limit RPCs + exact windows

| Function                        | Ledger                   | Caller                      |
| ------------------------------- | ------------------------ | --------------------------- |
| `consume_public_action_attempt` | `public_action_attempts` | `public-booking-actions`    |
| `consume_auth_email_send`       | `auth_email_rate_limits` | recovery/email-change flows |

| Surface/action             |                     Window |             IP limit | Phone/scope limit | Storage / cleanup                                                |
| -------------------------- | -------------------------: | -------------------: | ----------------: | ---------------------------------------------------------------- |
| booking submit             |         10m IP / 24h phone | 10 accepted attempts | 5 recent bookings | `booking_attempts`; cron prunes >2d; phone count from `bookings` |
| secure-link request        |                        10m |                    8 |       3 per email | `public_action_attempts`                                         |
| review                     |                        24h |                    5 |                 2 | `public_action_attempts`                                         |
| public `review`            |                        24h |                    5 |                 2 | `public_action_attempts`                                         |
| auth recovery/email-change | 1m per `(kind,scope_hash)` |                  n/a |            1 send | `auth_email_rate_limits`; no pruning job                         |

`consume_public_action_attempt()` records only accepted attempts, then inline-prunes `public_action_attempts.created_at < now() - interval '2 days'`; rate-limit rejections return before prune. `booking_attempts` cleanup is a separate cron.

### 6.5 Booking email/reminder functions

| Function                                | Role                                          |
| --------------------------------------- | --------------------------------------------- |
| `queue_booking_email_delivery`          | booking trigger → durable email job           |
| `booking_email_delivery_for_dispatch`   | validate/return dispatching job               |
| `mark_booking_email_delivery_recipient` | durable recipient acknowledgement             |
| `complete_booking_email_delivery`       | close delivered/skipped/superseded job        |
| `fail_booking_email_delivery`           | retry/backoff                                 |
| `queue_due_booking_email_deliveries`    | cron → pg_net webhook                         |
| `booking_confirmation_details`          | server-only booking/customer/business payload |
| `email_template_for_delivery`           | active editable template copy                 |
| `queue_booking_reminder_after_insert`   | insert eligible reminder                      |
| `queue_due_booking_reminders`           | reminder dispatcher                           |
| `mark_booking_reminder_delivered`       | reminder completion                           |

### 6.6 Calendar functions

| Function                        | Caller / role                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `calendar_connection_status`    | admin Calendar adapter                                                               |
| `calendar_store_token`          | OAuth callback                                                                       |
| `calendar_sync_source`          | `external-cleanup` + Calendar flows; authoritative booking/token re-read             |
| `calendar_record_event`         | sync/backfill mapping write                                                          |
| `calendar_record_error`         | sync/backfill error state                                                            |
| `calendar_backfill_source`      | OAuth callback future-confirmed backfill                                             |
| `queue_calendar_event_deletion` | deduplicated booking→Google deletion action for cancellation/delete/disconnect/races |
| `calendar_deletion_context`     | cleanup context                                                                      |
| `calendar_forget_event`         | external executor                                                                    |
| `prepare_calendar_disconnect`   | disconnect Edge Function                                                             |
| `calendar_delete_token`         | executor after cleanup                                                               |

### 6.7 External-action/media functions

| Function                          | Role                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `queue_external_action`           | internal durable enqueue                                                                                      |
| `external_action_for_dispatch`    | server dispatch context                                                                                       |
| `claim_external_action`           | claim with dispatch token                                                                                     |
| `complete_external_action`        | success completion                                                                                            |
| `fail_external_action`            | retry/backoff                                                                                                 |
| `block_external_action`           | non-retryable blocked state                                                                                   |
| `queue_due_external_actions`      | cron dispatcher                                                                                               |
| `queue_orphaned_storage_objects`  | detect DB-unreferenced business-owned Storage objects                                                         |
| `queue_storage_deletion`          | safe internal storage-delete enqueue                                                                          |
| `internal_queue_storage_deletion` | service-only media cleanup seam                                                                               |
| `internal_queue_auth_user_delete` | account cleanup enqueue                                                                                       |
| `internal_insert_gallery_image`   | media metadata insert                                                                                         |
| `internal_delete_gallery_image`   | metadata delete + storage cleanup                                                                             |
| `internal_replace_barber_photo`   | avatar replace + old-object cleanup (`internal_replace/delete_barber_photo()` is the compact conceptual pair) |
| `internal_delete_barber_photo`    | avatar delete + cleanup                                                                                       |

### 6.8 Authorization/helper residue

- `current_role()`, `current_barber_id()`, `is_owner()`.
- `taken_slots()` = retired superseded availability helper; live public UI uses `available_slots()`.
- `queue_booking_confirmation()` = retired legacy pre-ledger function. Current booking email events use `queue_booking_email_delivery()` + `booking_email_delivery_jobs`.

### 6.9 Triggers, cron, external webhook

| Trigger                                   | Table/event                       | Function                                |
| ----------------------------------------- | --------------------------------- | --------------------------------------- |
| `booking_email_delivery_on_insert`        | `bookings` AFTER INSERT           | `queue_booking_email_delivery()`        |
| `booking_email_delivery_on_status_change` | `bookings` AFTER UPDATE OF status | `queue_booking_email_delivery()`        |
| `booking_reminder_on_insert`              | `bookings` AFTER INSERT           | `queue_booking_reminder_after_insert()` |
| `booking_calendar_cleanup_on_status`      | `bookings` AFTER UPDATE OF status | `queue_booking_calendar_cleanup()`      |
| `booking_calendar_cleanup_on_delete`      | `bookings` AFTER DELETE           | `queue_booking_calendar_cleanup()`      |

Older direct booking-email triggers are dropped by the durable email migration.

| pg_cron job                       | Schedule            | Action                                 |
| --------------------------------- | ------------------- | -------------------------------------- |
| `booking-reminder-dispatch`       | every minute        | `queue_due_booking_reminders()`        |
| `booking-email-delivery-dispatch` | every minute        | `queue_due_booking_email_deliveries()` |
| `booking-email-delivery-cleanup`  | daily 03:17         | delete completed jobs >90d             |
| `external-action-dispatch`        | every minute        | `queue_due_external_actions()`         |
| `booking-attempt-cleanup`         | hourly at minute 23 | delete booking attempts >2d            |

**Retired external webhook:** current Calendar sync does not require a Dashboard Database Webhook or `calendar-sync`; the migration-owned `booking_calendar_sync_on_change` trigger queues durable jobs for `external-cleanup`. Verify the retired function and `calendar_sync_on_bookings` trigger are absent in live state.

### 6.10 State ownership quick index

| State                          | Storage / owner                              | Authority                                                                                |
| ------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Booking draft                  | `BookingFlow` component state                | typed fields tracked separately; untouched auto-fill follows verified profile; ephemeral |
| Public theme/lang/view/dialogs | `App.tsx`                                    | ephemeral                                                                                |
| Current customer access token  | `customer_booking_access_tokens`             | current email bearer credential; encrypted token + lookup hash                           |
| Customer session               | `__Host-bladeblend_customer_session`         | first-party HttpOnly session; server-backed profile/access                               |
| Storage consent                | cookie `bladeblend_storage_preferences`      | `essential` or `functional` preference                                                   |
| Public auth                    | none persisted                               | intentionally anonymous                                                                  |
| Admin session                  | Supabase Auth local storage `knc-admin-auth` | credential/session                                                                       |
| Admin role/link                | `auth.users` + `profiles`                    | identity/authorization                                                                   |
| Bookings                       | `bookings`                                   | persistence                                                                              |
| Services price/duration        | `services`                                   | commercial truth                                                                         |
| Working hours                  | `barber_schedules`                           | schedule truth                                                                           |
| Time off / blocks              | `barber_time_off`, `barber_slot_blocks`      | availability exclusions                                                                  |
| Public copy/facts              | CMS tables + discovery RPC                   | mutable site truth                                                                       |
| Reviews                        | `reviews`                                    | review records                                                                           |
| Booking email                  | `booking_email_delivery_jobs`                | delivery ledger                                                                          |
| Reminder                       | `booking_reminders`                          | reminder ledger                                                                          |
| External cleanup               | `external_action_jobs`                       | lifecycle/outbox state                                                                   |
| Google connection              | `barber_calendar_tokens`                     | connection/token state                                                                   |
| Google mapping                 | `calendar_event_map`                         | booking↔event mapping                                                                    |

---

## 7. External Boundaries, Security Contracts, and Configuration

### 7.1 Runtime boundary map

| Boundary                        | Caller                     | Security contract                                                                                                                                                    | Failure behavior                              |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Public Supabase client          | public browser             | anon key, no persisted auth; RLS/RPC                                                                                                                                 | typed/closed adapter failures                 |
| Admin Supabase client           | lazy admin browser         | anon key + persisted user session `knc-admin-auth`                                                                                                                   | profile/RLS/Edge checks                       |
| `submit-booking`                | anonymous browser          | `verify_jwt=false`; Turnstile + IP salt + service-role RPC                                                                                                           | expected domain rejection `{ok:false}`        |
| `public-booking-actions`        | anonymous browser          | `verify_jwt=false`; Turnstile/rate-limit only for link requests and reviews; current email-scoped permanent token for history/cancellation; legacy sessions accepted | typed action errors                           |
| `admin-create-barber`           | authenticated owner        | JWT + internal user/profile owner check                                                                                                                              | deny invalid owner/link state                 |
| `admin-manage-barber`           | authenticated owner        | JWT + owner check                                                                                                                                                    | durable Auth side effects when needed         |
| Calendar OAuth start/disconnect | authenticated barber       | JWT + linked active barber                                                                                                                                           | deny unauthorized account                     |
| Calendar callback               | Google redirect            | `verify_jwt=false`; HMAC state + active linked barber                                                                                                                | fail closed invalid/expired state             |
| `send-confirmation`             | DB cron/pg_net             | `verify_jwt=false`; `WEBHOOK_SECRET`; dispatch RPC                                                                                                                   | durable ledger retry/idempotency              |
| `external-cleanup`              | DB cron/pg_net             | `verify_jwt=false`; `WEBHOOK_SECRET`; dispatch token                                                                                                                 | outbox retry/block                            |
| `upload-image`                  | authenticated admin        | JWT + role/profile + server decode                                                                                                                                   | reject invalid/oversize before durable DB ref |
| Resend                          | Edge Functions             | `RESEND_API_KEY`                                                                                                                                                     | booking retry or direct auth-mail error       |
| Google Calendar                 | Calendar functions/cleanup | OAuth client + stored refresh token                                                                                                                                  | record sync error; durable deletion           |
| Supabase Storage                | upload/cleanup             | service client                                                                                                                                                       | durable old-object cleanup                    |
| Worker discovery                | Cloudflare Worker          | public Supabase URL + anon key                                                                                                                                       | checked-in fallback                           |

### 7.2 Frontend build-time vars

| Variable                  | Purpose                                                  |
| ------------------------- | -------------------------------------------------------- |
| `VITE_SITE_URL`           | canonical public origin                                  |
| `VITE_CLOCK`              | `real` production date source or `fixed` visual baseline |
| `VITE_SUPABASE_URL`       | public Supabase URL                                      |
| `VITE_SUPABASE_ANON_KEY`  | public anon key                                          |
| `VITE_TURNSTILE_SITE_KEY` | public Turnstile widget key                              |

All `VITE_*` are browser-visible; browser persistence such as `localStorage` is not a trust boundary.

### 7.3 Cloudflare Worker config

- `wrangler.jsonc` disables cache on default Worker entrypoint and enables it only on exported `PublicContent`. Keep hostname canonicalization outside cached entrypoints: Workers Cache keys do not isolate custom hostnames.
- `SUPABASE_URL`: checked-in Wrangler var; currently `https://soktgawvexeumqvtyhda.supabase.co`. A project move requires editing `wrangler.jsonc`; changing only anon key is insufficient.
- `SUPABASE_ANON_KEY`: Worker runtime value set through Wrangler secret storage for server-side public discovery.
- `CUSTOMER_GATEWAY_SECRET`: same high-entropy secret in Worker and Edge; signs customer-proxy IP/origin/body/timestamp. Never browser-visible.
- URL + anon key must target the same project. The anon key remains a public Supabase credential by design even if stored as a Worker secret.

### 7.4 Edge Function environment

Built-in/project: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (user-context clients such as admin/media gateways), `SUPABASE_SERVICE_ROLE_KEY`.

Application-specific (including `PUBLIC_SUPABASE_URL`, `PUBLIC_SITE_ORIGINS`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`):

```text
PUBLIC_SUPABASE_URL        # upload-image public media URL override; fallback SUPABASE_URL
TURNSTILE_SECRET
IP_SALT
PUBLIC_ACTION_HASH_SALT
CUSTOMER_GATEWAY_SECRET
PUBLIC_SITE_ORIGINS
RESEND_API_KEY
GOOGLE_OAUTH_CLIENT_ID     # identifier/config, not secret by itself
GOOGLE_OAUTH_CLIENT_SECRET
CALENDAR_STATE_SECRET
WEBHOOK_SECRET
```

`PUBLIC_ACTION_HASH_SALT` also derives the at-rest encryption key for permanent customer tokens in `send-confirmation` and `public-booking-actions`; rotate it only with a deliberate token-repair/rotation plan. `npm run verify:production-secrets -- --project-ref <ref>` checks required Edge Function and database Vault secret names, rejects the legacy `BOOKING_WEBHOOK_SECRET` alias, and verifies webhook-secret digest parity without printing secret values or digests.

### 7.5 Database Vault

| Vault name                 | Reader                       | Purpose                                              |
| -------------------------- | ---------------------------- | ---------------------------------------------------- |
| `booking_confirmation_url` | email + reminder dispatchers | `send-confirmation` target                           |
| `external_cleanup_url`     | external-action dispatcher   | `external-cleanup` target                            |
| `booking_webhook_secret`   | both dispatcher families     | `x-webhook-secret`; must equal Edge `WEBHOOK_SECRET` |

Booking INSERT trigger only queues durable DB state; it does not need these Vault keys.

### 7.6 Backup workflow config

`.github/workflows/database-backup.yml`: secret `SUPABASE_DB_URL`; repo var `SUPABASE_URL`; secret `SUPABASE_STORAGE_SECRET_KEY`; repo var `BACKUP_AGE_RECIPIENT` (public `age1...` recipient).

### 7.7 Static Asset CSP / headers

`public/_headers` is production integration architecture. New browser API/widget/iframe/image/font/websocket origins require policy changes + tests.

```text
default-src 'self'
script-src 'self' https://challenges.cloudflare.com
style-src 'self' 'unsafe-inline'
img-src 'self' https://*.supabase.co
font-src 'self'
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com
frame-src https://challenges.cloudflare.com
manifest-src 'self'
base-uri 'none'
form-action 'none'
frame-ancestors 'none'
object-src 'none'
upgrade-insecure-requests
```

Also: HSTS, `nosniff`, `X-Frame-Options: DENY`, strict referrer policy, restrictive Permissions-Policy, COOP/CORP, DNS-prefetch disabled. `/assets/*` + `/fonts/*`: one-year `immutable` cache. Unsupported `/.well-known/acp.json` returns a noindex 404. Dynamic homepage starts from Asset response (preserving security headers) but forces no-cache. Successful Worker-generated `/llms.txt` uses its own text/cache headers.

### 7.8 Edge JWT modes

| Function                  | `verify_jwt` |
| ------------------------- | -----------: |
| `send-confirmation`       |        false |
| `send-recovery-email`     |        false |
| `send-email-change`       |         true |
| `submit-booking`          |        false |
| `public-booking-actions`  |        false |
| `admin-create-barber`     |         true |
| `admin-manage-barber`     |         true |
| `calendar-oauth-start`    |         true |
| `calendar-oauth-callback` |        false |
| `calendar-disconnect`     |         true |
| `upload-image`            |         true |
| `external-cleanup`        |        false |

`verify_jwt=false` ≠ trusted/public: each path has a challenge, shared secret, HMAC state, or dispatch contract.

---

## 8. Test and Verification Map

### 8.1 What each layer proves

| Layer              | Command/location                             | Proves                                                                                                                               |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Unit               | `npm test` / targeted `npx vitest run ...`   | pure logic, parsers, adapter contracts, scripts, Worker behavior                                                                     |
| Integration        | `npm run test:integration`                   | live local Supabase adapter/auth/RPC/RLS flows                                                                                       |
| pgTAP              | `npx supabase test db --local`               | effective schema, constraints, grants/RLS, functions, gateway contracts                                                              |
| Edge type check    | CI Deno `2.9.5` loop                         | every `supabase/functions/*/index.ts` checks with frozen lock                                                                        |
| Browser smoke      | `npm run test:e2e`; `npm run test:e2e:admin` | public interactions; admin persisted writes across ABA/remount/failure, load gates, customer field ownership, delayed catalog reveal |
| Customer browser   | `npm run test:e2e -- --customer`             | real HTTPS Worker/Edge/DB; Chromium/Firefox/WebKit cookies, identity switching and revocation                                        |
| Visual             | `tools/visual/capture.mjs` + `compare.mjs`   | 8 deterministic homepage variants plus the Swedish privacy-banner baseline                                                           |
| Cloudflare dry run | `npm run deploy:dry-run`                     | build + Wrangler deployment validation                                                                                               |
| Live smoke         | `node tools/smoke-live.mjs`                  | live Supabase availability/gateway/security; **not** full Worker metadata validation                                                 |

`npm run test:e2e -- --customer` additionally runs the actual HTTPS Worker → Edge → DB in Chromium, Firefox and WebKit. The existing smoke script owns temporary TLS/build/server lifecycle and isolated fixtures. It rejects remote stack URLs; only blocked-cookie acceptance is intercepted, with real backend responses. It proves successful profile hydration/customer switching, cookie acceptance/denial, invalid links, rotation, concurrent first bookings, optional receipt scope, withdrawal and cancellation.

### 8.2 Integration test constraints

`vitest.integration.config.ts`: `fileParallelism: false`, `testTimeout: 30_000`, `hookTimeout: 30_000`. Suites share one local Supabase/PostgreSQL stack and reset shared tables. **Do not enable cross-file concurrency**; truncate/fixture races create misleading failures.

`tests/integration/reviewAccessHelpers.ts` supplies Node integration with an explicit test origin and cookie jar: the real `customerGateway` Worker handler calls the running Edge/DB. Permanent-link/customer-switch/rotation coverage lives in existing `reviews.test.ts`. The local/CI `CUSTOMER_GATEWAY_SECRET` must match the Edge env. CI restores current migrations after historical rollout compatibility checks. Five concurrency cases in `reviews.test.ts` observe actual `pg_blocking_pids`: permanent/legacy mint versus rotation in both lock orders, and repair versus newer rotation. Credential/outbox cleanup stays scoped to each test identity.

`tests/integration/_helpers.ts` exports `TURNSTILE_TEST_TOKEN = 'integration-test-token'` (`TURNSTILE_TEST_TOKEN`). Local/CI Edge Functions use Cloudflare's official always-pass test secret `1x0000000000000000000000000000000AA`, so normal `siteverify` accepts that token. Reuse the helper token; it is not an application bypass.

Local transport: `vite.config.ts` forwards exact customer API/root-link routes to a validated loopback Worker for dev and preview, preserving Host/Origin and supplying the local socket IP. Optional TLS files enable HTTPS; optional `/__supabase` loopback bridge strips site cookies and upstream Set-Cookie while preserving bearer auth. [README local setup](README.md#local-customer-links-and-cookies) owns commands. Production Worker routing/cookie policy remains separate.

### 8.3 Change → focused tests

| Change                          | Focused tests                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| booking/contact validation      | `tests/unit/validation.test.ts`                                                                                                                                                          |
| admin service values/order      | `serviceValidation.test.ts`, `reserveDialogContract.test.ts`, `servicesAdmin.test.ts`, `services.ordering.test.ts`, `42_decimal_service_values_test.sql`, `43_service_ordering_test.sql` |
| mock slot packing               | `slotPacking.test.ts`, `calendar.test.ts`, `bookingLinks.test.ts`                                                                                                                        |
| Stockholm conversion            | `stockholmTime.test.ts`                                                                                                                                                                  |
| ICS/calendar links              | `calendar.test.ts`, `ics.test.ts`, `bookingLinks.test.ts`                                                                                                                                |
| booking catalog + weekdays      | `bookingCatalog.test.ts`, `supabaseServices.test.ts`, `40_public_booking_catalog_test.sql`, public-site integration                                                                      |
| lazy/performance lifecycles     | `lazySurface.test.ts`, `performanceLifecycle.test.ts`, `siteChrome.test.ts`, `supabaseSiteChrome.test.ts`, browser smoke                                                                 |
| public self-service             | `src/mybookings/`, `publicBookingActions`, `publicBookingActionAdapters`, `39_permanent_customer_booking_access_test.sql`, `45_retire_legacy_customer_lookup_test.sql`                   |
| reviews                         | `reviewValidation`, `reviewGatewayContract`, integration reviews                                                                                                                         |
| About CMS merge                 | `aboutMerge.test.ts`                                                                                                                                                                     |
| admin schedule/conflicts        | `adminTime`, `scheduleConflicts`, `availabilityMutationAdapters`                                                                                                                         |
| admin booking grouping/deletion | `bookingsSections`, `weekOfYear`, `deleteAdapters`                                                                                                                                       |
| admin auth/account links        | `adminAuth`, `passwordPolicy`, `recoveryLink`, `emailChangeLink`, `barberAccountAdmin`, `barberLinkStatus`                                                                               |
| site CMS/discovery/SEO          | `siteChrome`, `supabaseSiteChrome`, `businessStructuredData`, `discovery`, `workerRoutes`                                                                                                |
| image gateway/runtime           | `imageUploadAdapters.test.ts`, `uploadImageDependency.test.ts`, `uploadImageRuntime.test.ts`                                                                                             |
| email/outbox/secrets            | `emailBusiness.test.ts`, `webhookSecretContract.test.ts`, `productionSecrets.test.ts`, `46_retire_superseded_booking_contract_test.sql`                                                  |
| Google Calendar                 | `calendarSync`, `calendarDeletionOwnership`, `externalActions`, `47_calendar_customer_contact_test.sql`                                                                                  |
| backup scripts                  | `backupScripts.test.ts`                                                                                                                                                                  |
| CI pins/actions/locks           | `ciSupplyChain.test.ts`                                                                                                                                                                  |

### 8.4 Actual CI gate

`.github/workflows/ci.yml` is definitive.

```text
frontend/browser:
  npm ci
  npm audit --omit=dev --audit-level=high
  npm run format:check
  npm run lint
  npm run typecheck
  npm test
  npm run build
  npm run deploy:dry-run
  font-license/artifact checks
  Playwright smoke
  visual capture + pixel compare

edge:
  deno check --frozen --node-modules-dir=manual each supabase/functions/*/index.ts

database/integration:
  write local function test env
  npx supabase start
  bash tools/release/test-public-booking-stages.sh
  npx supabase db reset --local
  npx supabase test db --local
  npm run test:integration
  install Playwright Chromium/Firefox/WebKit
  npm run test:e2e -- --customer
  npx supabase stop --no-backup
```

Useful local frontend baseline: `npm run typecheck && npm run lint && npm test && npm run deploy:dry-run`; not a substitute for full CI.

---

## 9. Cross-Cutting Change Recipes

### 9.1 Public booking field

Touch only required layers, but inspect in this order:

`src/booking/domain.ts` → `validation.ts` (customer input) → `BookingFlow.tsx` / `DetailsDialog.tsx` → `src/backend/rpcSchemas.ts` → `supabaseBooking.ts` → `submit-booking/index.ts` parser → migration for `bookings`/RPC signature/body if persisted → customer/admin lookup schemas if exposed → email/templates if emitted → unit+integration+pgTAP contract tests.

Do not send client commercial fields when server can derive them.

### 9.2 Business/site setting

`business.ts` or `siteChrome.ts` canonical key/default → resolver/wire schema → owner control `SiteView.tsx` / `siteAdmin.ts` → migration seed/update `site_settings` → if SEO/email/discovery, add to `public_business_discovery()` whitelist + Worker/email consumers → site chrome + structured-data + Worker + discovery tests.

### 9.3 About copy field

About key typing/default → merge logic → migration updating `about_content` key constraint if DB-backed → About admin UI → `aboutMerge.test.ts` + relevant UI checks.

### 9.4 Email template type

`EmailTemplateName` in `emailTemplatesAdmin.ts` + `_shared/email.ts` → any constrained wire/admin schema → server defaults → `MailView.tsx` definition/placeholder guidance → migrate `email_templates_template_check` + seed rows → event/sender wiring → `emailBusiness.test.ts` + pgTAP template coverage.

### 9.5 New admin tab

`AdminShell.tsx` `Tab` + `TABS` → SV/EN `src/i18n/adminStrings.ts` → view in `src/admin/views/` → adapter/port if data access → `renderView()` branch → targeted unit/browser coverage.

### 9.6 Transactional availability mutation

Follow `20260813115437_transactional_availability_mutations.sql`: authorize inside SECURITY DEFINER RPC → barber availability advisory lock → affected windows → explicit `booking_conflict` IDs unless existing bookings allowed → atomic mutation → revoke corresponding direct write if RPC becomes sole add/update path → adapter Zod schema + integration/pgTAP.

### 9.7 Durable external cleanup/lifecycle action

Migrate action-type constraint → parser/executor branch in `_shared/externalActions.ts` → enqueue inside authoritative DB transaction via internal RPC/trigger → define dedupe semantics → classify retryable vs blocked → extend `externalActions.test.ts` + pgTAP outbox. Do not use the outbox for ordinary synchronous work just because it exists.

### 9.8 Production-domain change

Audit all canonical-origin surfaces together; `VITE_SITE_URL` alone is insufficient:

- `src/worker.ts`: `CANONICAL_HOST`, `SITE_URL`.
- `wrangler.jsonc`: custom-domain routes.
- `supabase/config.toml`: Auth `site_url`, redirect allowlist, SMTP/admin identity if domain-specific.
- `_shared/email.ts` + `send-confirmation`, `send-recovery-email`, `send-email-change`, `admin-create-barber`: generated links/sending identity where hardcoded.
- `public-booking-actions/index.ts`: default CORS origins.
- `src/site/business.ts`: structured-data/canonical defaults.
- `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`, `public/privacy.html`, `public/google-calendar.html`.
- runbooks/docs + domain-sensitive tests (`workerRoutes.test.ts`, `emailBusiness.test.ts`).
- External: Cloudflare custom domain/DNS, Supabase Auth redirects, Resend domain/DKIM/SPF, Google OAuth redirect URIs, Dashboard webhook/origin config.

Search for the **old hostname** before declaring complete.

---

### Launch information pages

`src/site/routeMetadata.ts` shares fixed private route titles between Worker and client; arbitrary paths/tokens never enter titles. The Worker removes homepage canonical metadata on private routes. Homepage initial HTML contains readable CMS business/contact text inside `#root`, replaced by Preact at startup. Script-free privacy, terms and 404 pages provide navigation and one h1. `public/info.css` styles terms and 404; sitemap and dynamic/static llms list only public information pages.

## 10. Deployment, Operations, and Backup

### 10.1 High-risk zones

| Area                    | Why high risk / required discipline                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public booking contract | `submit-booking`, `public-booking-actions`, pre-expand hardening `20260813123851_review_hardening.sql`, expand migration `20260813123852_expand_public_booking_gateway.sql`, contract migration `20260813123853_contract_public_booking_gateway.sql`, rollout runbook. Wrong grant/deploy order can break booking or reopen anon privilege. |
| Availability            | `create_booking`, `available_slots`, GiST, transactional availability migrations, `stockholmTime.ts`; client-only fixes are insufficient.                                                                                                                                                                                                   |
| RLS/grants              | Later migrations revoke earlier direct writes; always inspect final effective state.                                                                                                                                                                                                                                                        |
| Email                   | Two booking-email ledgers + separate cron dispatchers; both depend on Vault URL/secret + `WEBHOOK_SECRET` parity.                                                                                                                                                                                                                           |
| Calendar                | Create/update/delete/disconnect use the durable outbox. Legacy `calendar-sync` is not a DB dependency; remove deployed function only after live replacement checks.                                                                                                                                                                         |
| Media deletion          | Keep server + outbox ownership; no direct browser delete shortcuts. Homepage logo replacement/removal is `upload-image` → `site_settings.homepage_logo_path` → durable gallery cleanup.                                                                                                                                                     |
| Admin account lifecycle | Keep `profiles.account_enabled`, Auth ban/delete state, and durable actions coherent.                                                                                                                                                                                                                                                       |
| Migrations              | Migrations only. Production booking gateway uses staged expand/deploy/switch/verify/contract, not unrestricted `db push`.                                                                                                                                                                                                                   |

### 10.2 Public booking gateway rollout

Authoritative runbook: `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md`.

```text
1 EXPAND
  verified linked baseline already includes 20260813123853_contract_public_booking_gateway.sql
  and continues through 20260827170300_harden_internal_function_privileges.sql
  use tools/release/public-booking-migration-stages.sh for the exact five reviewed post-baseline migrations
  direct anon RPC access is already denied; the three retirement functions still exist for service-role gateway compatibility

2 DEPLOY EDGE FUNCTIONS
  run npm run verify:production-secrets -- --project-ref <ref>
  deploy all non-image functions with --use-api; deploy upload-image separately with local Docker
  bundling because config includes static_files=["./functions/upload-image/magick.wasm"]

3 SWITCH FRONTEND / WORKER
  build/deploy Worker; ensure Worker SUPABASE_ANON_KEY is set

4 VERIFY COEXISTENCE
  node tools/smoke-live.mjs + runbook production UI/manual checks

5 CONTRACT
  use the same explicit selector, applying --include-all only to the staged Contract tree, adding 20260901011632, 20260901011908, and 20260901012503
  direct anon customer RPC execution remains denied; the three retired function families become absent

6 RE-VERIFY
```

After contract, regranting anonymous mutation/lookup RPC execution is emergency rollback only per runbook.

### 10.3 Cloudflare runtime

`wrangler.jsonc`: `run_worker_first` excludes immutable assets/fonts; entry `src/worker.ts`; Vite output `./dist` via `ASSETS`; uncached default entrypoint handles hostname/route policy, cached named `PublicContent` handles only canonical apex homepage + `/llms.txt`; custom domains apex + `www`; compatibility date `2026-08-09`; checked-in `SUPABASE_URL` is independent of `VITE_SUPABASE_URL`. Project migration therefore requires both `wrangler.jsonc` URL and matching runtime `SUPABASE_ANON_KEY` before deploy.

### 10.4 Operational tooling

| Tool                                               | Purpose                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `tools/smoke-live.mjs`                             | live Supabase availability/gateway/direct-RPC contract smoke |
| `tools/release/test-public-booking-stages.sh`      | validate expand/contract compatibility locally               |
| `tools/release/public-booking-migration-stages.sh` | shared explicit migration manifest for rollout and CI        |
| `tools/backup/capture-storage-references.sh`       | capture DB-owned Storage refs                                |
| `tools/backup/storage-backup.sh`                   | export Storage objects + metadata/checksums                  |
| `tools/backup/storage-restore.sh`                  | restore + verify Storage                                     |
| `tools/backup/verify-backup-tree.sh`               | validate backup structure/manifests/lineage                  |
| `tools/backup/prepare-migration-history.sql`       | restore migration-lineage prep                               |
| `tools/e2e/smoke.mjs`                              | Playwright smoke                                             |
| `tools/e2e/admin-state.mjs`                        | Admin history/delayed-scroll/CMS draft browser regression    |
| `tools/e2e/admin-harness.html`, `.tsx`             | In-memory Vite source harness for admin browser test         |
| `tools/visual/capture.mjs`                         | 8 homepage variants plus the Swedish privacy-banner state    |
| `tools/visual/compare.mjs`                         | pixel compare vs approved baseline                           |
| `tools/og/render.mjs`                              | social-card generation                                       |
| `tools/seed-admin-users.mjs`                       | local/admin seed helper                                      |

### 10.5 Backup properties + restore invariants

Scheduled workflow: daily `02:17 UTC`; dumps schema/data/migration history; exports current Storage; cross-checks DB Storage refs; SHA-256 manifests; tar; `age` encrypt; delete plaintext; upload only encrypted archive + checksum.

Restore authority: `docs/operations/BACKUP_RESTORE.md`. Procedure targets a **newly-created Supabase project only**, never an existing environment:

1. Restore `schema.sql` + `data.sql` in one transaction with `session_replication_role = replica`. Backup includes Auth users but excludes Storage metadata; managed roles/project/dashboard config come from new target and are not restored.
2. In one transaction, run `tools/backup/prepare-migration-history.sql`, `history_schema.sql`, then `history_data.sql`. The preparation removes only the disposable target's migration schema; the archived source defines every lineage column and constraint, independent of target CLI version.
3. Restore Storage bucket metadata and bytes with `tools/backup/storage-restore.sh`, then `--verify-only` for byte count/SHA-256/inventory parity. The reference snapshot includes gallery, barber-photo, and `site_settings.homepage_logo_path` bytes.
4. Reconfigure Auth URLs/SMTP, Edge secrets, cron, Database Webhooks, Google/Resend/Cloudflare, and other provider/project state separately.

`verify-backup-tree.sh` asserts `data.sql` contains `auth.users` but no Storage metadata; both history files contain `supabase_migrations.schema_migrations`; Storage archive metadata and bytes are checksummed separately. Keep cron/external dispatch disabled during restore drills.

---

## 11. Canonical Symbol Index

Use this instead of grep for first-hop navigation.

| Concept                                  | Canonical path / symbol                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| Public Supabase configured?              | `src/backend/config.ts:isBackendConfigured`                                       |
| Public client                            | `src/backend/supabaseClient.ts:getSupabase`                                       |
| Admin client                             | `src/admin/adminClient.ts:getAdminClient`                                         |
| Booking port                             | `src/booking/port.ts:BookingPort`                                                 |
| Live booking adapter                     | `src/booking/adapters/supabaseBooking.ts:supabaseBookingAdapter`                  |
| Shared public booking catalog            | `src/booking/adapters/supabaseBookingCatalog.ts` / `public_booking_catalog()`     |
| Service-aware availability               | `available_slots_for_service`                                                     |
| Mock availability engine                 | `src/booking/slotPacking.ts:packSlots` via `localCalendar.ts`                     |
| Live availability                        | DB `available_slots`                                                              |
| Stockholm wall-time conversion           | `localWallClockToStockholmIso`                                                    |
| Booking submit gateway                   | `supabase/functions/submit-booking/index.ts`                                      |
| Shared customer gateway wrapper          | `src/backend/publicBookingActions.ts:invokePublicBookingAction`                   |
| Customer gateway                         | `supabase/functions/public-booking-actions/index.ts`                              |
| Permanent customer token crypto          | `supabase/functions/_shared/customerAccess.ts`                                    |
| Booking rate-limit RPC                   | `create_booking_with_limits`                                                      |
| Customer action limiter                  | `consume_public_action_attempt`                                                   |
| Admin profile resolve                    | `src/admin/auth.ts:getActiveProfile`                                              |
| Admin persisted session                  | `src/admin/adminClient.ts` / `knc-admin-auth`                                     |
| Customer session + consent               | `customerGateway.ts`; `storageConsent.ts` preference                              |
| Calendar adapter selector                | `src/admin/calendar/adapters/index.ts:defaultCalendarSyncPort`                    |
| Schedule transaction                     | `admin_save_barber_week` (`p_week`: JSONB, exactly 7 weekday objects)             |
| Time-off transaction                     | `admin_add_time_off`                                                              |
| Slot-block transaction                   | `admin_add_slot_block`                                                            |
| Public business discovery                | `public_business_discovery`                                                       |
| JSON-LD                                  | `src/site/business.ts:buildBusinessStructuredData`                                |
| Site live hydration                      | `src/site/adapters/supabaseSiteChrome.ts`                                         |
| Lazy-load boundary                       | `src/ui/LazySurface.tsx:LazySurface`                                              |
| Media gateway                            | `supabase/functions/upload-image/index.ts`                                        |
| Email builder                            | `supabase/functions/_shared/email.ts`                                             |
| Booking-email dispatcher                 | `queue_due_booking_email_deliveries`                                              |
| Reminder dispatcher                      | `queue_due_booking_reminders`                                                     |
| Calendar connection status               | `calendar_connection_status`                                                      |
| Calendar sync gateway                    | durable `booking_calendar_sync_on_change` trigger + `external-cleanup` dispatcher |
| Calendar mapping                         | `public.calendar_event_map`                                                       |
| Calendar deletion enqueue                | `queue_calendar_event_deletion`                                                   |
| Retired booking-email function           | `queue_booking_confirmation`                                                      |
| External outbox                          | `public.external_action_jobs`                                                     |
| External action executor                 | `_shared/externalActions.ts:executeExternalAction`                                |
| Cloudflare hostname gateway/public cache | `src/worker.ts` default / `PublicContent`                                         |

---

## 12. Documentation Trust / Known Drift

| Source                                           | Drift                                                                                                                                                                            | Trust instead                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| historical Calendar README                       | Older prose described broader backfill and disconnect behavior. Current code backfills future confirmed and removes mapped events through durable cleanup before token teardown. | current functions + `20260813115438_durable_storage_cleanup.sql`                                                                      |
| `docs/booking-notifications/*-PLAN.md`           | Planning documents describe pre-email-token/SMS architecture and unimplemented functions/tables. Keep as historical proposals; do not use as current runtime instructions.       | current migrations, Edge functions, `BACKEND.md`, and launch audit                                                                    |
| `BACKEND.md`                                     | Current operational facts include an explicit Worker customer proxy/session contract and a backup workflow that is blocked until secrets are configured.                         | current code, `docs/qa/2026-09-10-audit/sol-platform.md`, and `docs/operations/BACKUP_RESTORE.md`                                     |
| `supabase/functions/send-confirmation/README.md` | Function README describes the current durable booking-email ledger; it does not describe the separate customer-access session proxy.                                             | `public-booking-actions/README.md`, current Worker/Edge code, and subsystem ownership in §5                                           |
| `.claude/runtime/SLOT_PACKING_SPEC.md`           | Any statement that `BookingFlow.tsx` directly consumes `packSlots()` is shorthand for mock mode.                                                                                 | actual: `localCalendar.ts` consumes `slotPacking.ts`; live uses `available_slots()`                                                   |
| `src/admin/adapters/schedulesAdmin.ts` comments  | Header/JSDoc still describes old direct-upsert/RLS week save.                                                                                                                    | executable `saveWeek()` + `20260813115437_transactional_availability_mutations.sql`; direct authenticated schedule writes are revoked |
| `REVIEW_FINDINGS.md`                             | Predates later hardening migrations.                                                                                                                                             | historical context only; current code/migrations/tests                                                                                |

---

## Appendix A - Fast Commands

```bash
npm run build                 # typecheck + Vite production build
npm run typecheck             # TypeScript build check
npm run lint                  # ESLint
npm run format:check          # Prettier check
npm test                      # unit suite
npm run test:integration      # live local-Supabase integration suite
npx supabase test db --local  # pgTAP when local stack is running
npm run test:e2e              # browser smoke
npm run test:e2e:admin        # admin source-harness browser regressions (Vite dev on port 4188)
npm run deploy:dry-run        # build + Wrangler dry run
node tools/smoke-live.mjs     # live Supabase gateway/security smoke
```

## Appendix B - Read Before High-Risk Work

- `README.md`
- `BACKEND.md` - useful context; apply §12 drift notes.
- `LAUNCH_READINESS_PLAN.md`
- `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md`
- `docs/operations/BACKUP_RESTORE.md`
- Latest relevant migrations + tests for the subsystem being changed.
