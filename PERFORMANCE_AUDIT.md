# Performance Launch-Readiness Audit

Branch: `perf/launch-readiness-2026-08-28`
Baseline: `main@f184f10fbe7f87f4510081552520bde0992e9aba`
Scope: performance plus the explicitly added launch-blocking JPEG upload correctness fix. No unrelated feature, visual, copy, or refactor work.

## Operating checklist

- [x] Confirm repository and permissions.
- [x] Pin immutable baseline commit.
- [x] Create fresh performance branch.
- [x] Inventory application/runtime/build/deployment surface.
- [x] Audit every production-relevant source/config line for performance implications.
- [x] Establish baseline bundle/runtime/network characteristics from code and CI-accessible evidence.
- [x] Identify high-confidence performance defects and silent regressions.
- [x] Implement minimal, evidence-backed fixes.
- [x] Add/adjust tests or build guards for regressions.
- [x] Run static checks, unit/integration tests, build, E2E/visual checks where CI supports them.
- [x] Adversarially review the complete diff and attempt to disprove each optimization.
- [x] Open fresh PR against `main`.
- [ ] Submit review findings/comment per assignment.
- [ ] Confirm all CI checks are green.
- [x] Do not merge.

## Audit notes

### Baseline

- `main` head at audit start: `f184f10fbe7f87f4510081552520bde0992e9aba`.
- Repository contains 474 tracked blobs in the baseline recursive Git tree.
- Frontend uses Vite + Preact; Supabase and Cloudflare deployment/configuration are present.
- Container network access is unavailable, so repository inspection/writes and CI evidence are being performed through the connected GitHub tooling rather than a local clone.

### Guardrails

- Performance-only scope. Correctness/security issues discovered outside performance scope will be documented but not refactored unless they directly cause a performance problem.
- No optimization will be accepted solely because it reduces LOC or looks conventional; each change must have a concrete cost model and regression check.

### Edge delivery findings

- Baseline `assets.run_worker_first: true` routed every hashed JS/CSS/font/icon request through the Worker before static asset serving.
- Current Cloudflare Static Assets routing supports negative `run_worker_first` patterns; negative matches are served as assets without invoking the Worker.
- Baseline `GET /` awaited `public_business_discovery` and then returned `Cache-Control: no-cache`, forcing the Worker + Supabase metadata path on every document request.
- Live `pg_stat_statements`: `public_business_discovery()` averaged ~4.28 ms over 677 PostgREST calls; the material latency risk is the network/Worker round trip, not the SQL body.
- Enabled Workers Caching and set rendered homepage freshness to 60 s browser / 300 s shared cache. This allows a cached response to be returned before Worker execution while keeping CMS metadata bounded in staleness.
- Static hashed/assets/font/icon paths now bypass Worker-first routing and retain Cloudflare Static Assets automatic caching.
- Customer access-token redirects remain explicitly `no-store`; no user-specific Worker body was made cacheable.

### Database performance observations

- Supabase performance advisor reported no missing-index finding.
- Public RPC means from live statement stats: `public_business_discovery` ~4.28 ms; `public_booking_catalog` ~3.57 ms.
- Advisor-reported unused indexes are only 8–16 KiB each in this small database; scan absence is insufficient proof that rare-path/constraint-supporting indexes are safe to drop. No index deletion is being made.
- Multiple permissive RLS policies are advisor WARNs, but rewriting authorization predicates has a substantially higher correctness/security blast radius than the demonstrated query cost. No policy rewrite without an independently demonstrated hot query.

### Public runtime findings

- Baseline app started booking-catalog hydration + a Realtime subscription immediately on mount, before any booking/About interaction.
- Baseline About mounted below the fold and immediately loaded editable copy, roster/catalog, two galleries, reviews, and Turnstile challenge code.
- Baseline gallery had two perpetual animation-frame loops even while the entire About section was offscreen; reduced-motion still paid the scheduling loop.
- Baseline mobile scroll handler could commit a Preact state update for every native scroll event.
- Baseline My Bookings dialog code was statically reachable from the public entry despite being closed on initial render.

### Public runtime changes

- Non-critical booking catalog preload now starts during idle time; catalog Realtime starts only when booking/About mounts a real data consumer.
- Default public About data I/O is armed by IntersectionObserver only when the section actually enters the viewport; injected CMS/test ports remain eager so preview replicas and deterministic tests keep their semantics.
- Turnstile no longer loads solely because an offscreen review form exists.
- Gallery animation frames start only while a row intersects the viewport and the document is visible; reduced-motion schedules no auto-scroll frame loop.
- Mobile collapse state is synchronized at most once per animation frame.
- My Bookings is a lazy chunk loaded only when the dialog opens.

### Public Supabase bootstrap

- Baseline `supabaseSiteChromeAdapter.load()` statically imported `getSupabase()`, so the full Supabase JS client was pulled in merely to read public CMS chrome during initial hydration.
- Replaced only the anonymous read path with direct Data API `fetch` calls using the existing public key, while preserving all Zod boundary parsing and null-on-malformed behavior.
- The default public `useSiteChrome` path keeps Realtime out of initial hydration, then opens a visibility-gated subscription during idle time. Hidden tabs disconnect; visible pages retain live owner-edit freshness.
- Data API requests always send the public `apikey`; legacy JWT-shaped anon keys also send the bearer header required for equivalent RLS behavior, while opaque publishable keys are not misused as bearer tokens.

### Admin bundle findings

- Baseline admin entry statically imported all auth routes plus `AdminApp`; visiting `/login` therefore made the entire authenticated panel reachable from the first admin chunk.
- Baseline `AdminApp` statically imported `AdminShell` before session resolution.
- Baseline `AdminShell` statically imported every management view although only one tab is rendered.

### Admin bundle changes

- Reset/invite/confirm/admin routes are independently lazy; the login route stays eager inside the already-lazy admin entry to avoid a serial login waterfall.
- The authenticated shell and forced-password gate load only after their gate state is known.
- Each admin management view is a separate lazy chunk; changing tabs fetches only the selected surface.
- The existing E2E admin harness imports `AdminShell` directly and therefore continues exercising navigation while dynamic view imports resolve under Vite.

### Adversarial self-review corrections

- **Deferred About state attack:** if `reviewsState` starts as `ready` while data I/O is disabled, the first intersection can paint the empty-review message for one render before the effect flips to `loading`. Corrected by keeping the state `loading` until the actual list request resolves.
- **Admin split waterfall attack:** lazy-loading the default `ScheduleView` after an authenticated `AdminShell` adds a serial request on the most common first admin screen. Corrected by keeping `ScheduleView` in the authenticated shell chunk; less-common views remain lazy.

### Realtime/cache self-review

- **Persistent-socket attack:** the first public-runtime revision merely delayed the catalog Realtime subscription, so every visitor still opened a long-lived socket without using booking/About.
- Removed the app-wide catalog subscription. Idle preload remains for first-interaction speed; actual booking/About consumers retain the existing Realtime invalidation path.
- Added a 30-second cache freshness bound. If an idle-preloaded catalog sits unused beyond that window, the next consumer performs a current RPC read rather than trusting an arbitrarily old promise.
- Added a unit regression for the freshness boundary.
- CI run 65 exposed formatting drift in six files before lint/typecheck/build; those formatter findings are corrected in this commit.

### Edge image-processing cold path

- The tracked 14.7 MB `magick.wasm` is isolated to the admin `upload-image` Edge Function and is not a public-site asset.
- Baseline module evaluation immediately started reading and initializing ImageMagick for every cold isolate, including `OPTIONS` and JSON delete requests that never process pixels.
- ImageMagick initialization is now memoized lazily behind `ensureImageMagickReady()`; the first actual image upload pays the unavoidable processor setup, later uploads in the same isolate reuse it, and delete/preflight requests avoid the WASM read/compile path.

### JPEG upload correctness finding

- User-reported launch blocker: JPEG admin uploads can be rejected or stored corrupted while PNG appears reliable.
- Root cause confirmed against magick-wasm upstream behavior: `image.write()` callback bytes are backed by temporary WASM memory and must be copied before the callback returns.
- Baseline `encodeWebp()` assigned `encoded.value = data` and returned that borrowed buffer to later asynchronous Storage upload code.
- Fixed by copying with `new Uint8Array(data)` inside the callback. Added a source contract regression preventing borrowed-buffer assignment from returning.

### Supabase bootstrap adversarial correction

- **RLS header attack:** direct Data API reads initially sent only `apikey`. Supabase documents that RLS authorization is determined from the `Authorization` JWT, not the `apikey` header. Legacy anon JWTs now also receive `Authorization: Bearer <anon>`; opaque publishable keys are detected by shape and are not incorrectly sent as bearer tokens.
- Added a regression assertion covering both Data API calls' `apikey` and legacy bearer headers.
- **Idle socket attack:** the first revision kept a Realtime socket open even while the page was hidden. The final default path defers subscription until idle, disconnects while hidden, revalidates on visibility return, and reconnects only while the document is visible.

### Admin login waterfall correction

- **Login split attack:** `Root` already lazy-loads the admin entry. Making `LoginRoute` lazy inside that entry created a second serial request before the most common admin first screen could render.
- `LoginRoute` is eager again inside the admin entry. Reset/invite/confirm and authenticated admin code remain demand-loaded.

### Booking UI code split

- Baseline desktop/mobile layouts statically imported the full four-step `BookingFlow` even though the launch state is the closed homepage.
- `BookingFlow` is now a shared lazy chunk. The app preloads it during idle together with the catalog, and booking buttons trigger an earlier preload on pointer-down/focus.
- Desktop remembers the first mount and keeps the flow mounted thereafter, preserving its existing close animation instead of unmounting content mid-collapse.
- Early interaction before idle still starts the chunk on pointer/focus and falls back safely under Suspense.

### Baseline movement and rebase

- While this PR was in progress, `main` advanced from the pinned audit baseline `f184f10fbe7f87f4510081552520bde0992e9aba` to `9beab848af959d10e14a9e5dd70b4dafacbbda3b` via PR #20.
- PR #20 and this performance PR have zero overlapping changed paths. The validated performance tree is therefore rebased/squashed onto `9beab848af959d10e14a9e5dd70b4dafacbbda3b` without discarding the newly merged launch/security fixes.
- The original baseline remains recorded above because all before/after performance measurements were derived from that immutable commit.

### CI and bundle evidence before final rebase

- GitHub Actions run 77 on `3136a8909cbeef4ea1c977f57c5e06e3e36c9053` completed green: formatting, lint, TypeScript, 412 unit tests, Vite build, Wrangler deploy dry-run, browser smoke, Edge Function type checks, pgTAP, and adapter integration all passed.
- Browser smoke explicitly opened booking and waited for the barber step, so the lazy BookingFlow path was exercised rather than only compiled.
- Baseline build emitted three JS chunks above 100 kB: 174.36 kB / 49.99 kB gzip, 217.80 kB / 55.54 kB gzip, and 219.73 kB / 54.46 kB gzip.
- Run 77 emitted two JS chunks above 100 kB: 136.85 kB / 39.84 kB gzip and 215.36 kB / 54.57 kB gzip. The count of >100 kB chunks therefore fell from three to two.
- After the BookingFlow split, a 19.34 kB / 5.54 kB gzip demand chunk appeared and the smaller remaining >100 kB chunk fell from the intermediate 148.64 kB / 41.88 kB gzip to 136.85 kB / 39.84 kB gzip.
- Run 77 Vite production build completed in 6.15 s; the repeated build inside Wrangler dry-run completed in 6.00 s. Worker dry-run upload was 149.33 KiB / 26.55 KiB gzip.

### JPEG runtime regression

- Added a real 120×80 rectangular JPEG fixture test that initializes the exact vendored `magick.wasm`, decodes JPEG, writes WebP while copying callback bytes, validates the RIFF/WEBP signature, and decodes the copied WebP back to 120×80.
- A separate profile-path regression applies the production cover-resize + centered crop and verifies the copied WebP decodes to 800×800.
- Final rebased CI must pass this runtime test in addition to the existing source-contract guard before handoff.

### Barber profile corruption follow-up

- User reported that barber profile uploads render as broken/corrupted regardless of source image type.
- Production Storage logs confirm profile objects were successfully created in `barber-photos` and served with HTTP 200 to iPhone Safari, then removed shortly afterwards during repeated retries. The bucket itself is public and WebP-only, so this was not a private-bucket or missing-object response problem.
- Production currently has no surviving `barber_photos` row after those retries, consistent with the uploaded broken images being removed.
- The deployed/`main` upload gateway still contains the unsafe `encoded.value = data` assignment. The performance PR contains the corrected `new Uint8Array(data)` copy; therefore the observed production symptom is expected until the updated Edge Function is deployed.
- Added a profile-specific ImageMagick runtime regression using a real rectangular JPEG through the exact resize + centered 800×800 crop + copied WebP encode + decode path; this passed in CI, ruling out the crop/resize transform as a second corruption source.
- Added an owner integration regression that uploads PNG through the actual barber-profile gateway, fetches the public Storage object, validates `Content-Type: image/webp` and RIFF/WEBP signatures, then removes the profile.

### Review-comment corrections

- **Catalog preload/reconnect gap:** `SUBSCRIBED` is not treated as Postgres readiness. The catalog waits for Realtime's `system` message confirming `extension=postgres_changes` with `status=ok`, then performs an authoritative refresh. The same readiness-gated refresh repeats after reconnect, and table changes use the existing coalesced invalidation path.
- **SiteChrome live updates:** restored the public live-update contract with a visibility-gated subscription. Initial joins and reconnects wait for confirmed Postgres Changes readiness before the corrective re-read; hidden tabs disconnect, and returning to visibility performs an immediate read before resubscribing.
- **Homepage fallback caching:** successful Supabase discovery keeps the 60 s browser / 300 s shared TTL. Discovery fallback/error renders are `no-store`, so transient backend failure cannot seed five minutes of shared fallback metadata.

### Lazy interaction review correction

- Replaced interaction-critical `Suspense fallback={null}` surfaces with a shared accessible lazy boundary: loading state uses `role=status` / `aria-live`, import/runtime failure shows `role=alert`, and users receive an explicit reload recovery action.
- Booking uses an inline bounded loading/error surface; My Bookings uses a visible overlay fallback; authenticated admin and password-change surfaces use full-page fallbacks.
- My Bookings now preloads on pointer-down/focus for the primary buttons and also starts preload in the shared open handler, covering cancellation links that do not expose pointer-prefetch props.
- Browser smoke now opens and closes My Bookings before exercising BookingFlow, so both public interaction chunks are loaded in CI rather than only compiled.
