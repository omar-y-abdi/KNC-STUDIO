# KNC Studio — Consolidated Review Findings

Three independent, read-only review passes (one each), consolidated. Sources:
**[SEC]** Security & Auth · **[DB]** Backend & Database · **[CODE]** Code Quality.
Date: 2026-06-24. Scope: the production app (`src/`, `supabase/`, config) — `reference/` excluded.

---

## Executive summary

**Overall verdict: safe to operate as-is. No CRITICAL, and no HIGH issue that is live + exploitable today.**
All three reviewers independently rated the architecture strong: RLS + `SECURITY DEFINER` RPCs (all
`search_path=''`, schema-qualified, least-privilege) are a coherent boundary; the GiST exclusion
constraint is a real, concurrency-safe double-booking guarantee; **no `service_role`/secret reaches
the client or the built bundle**; XSS is closed (escaped JSX + strict CSP + lint enforcement); the TS
layer Zod-parses every wire response and race-guards every effect; i18n parity is compiler-enforced.

The real gaps are **abuse-resistance and a read/write asymmetry**, not broken access control:

1. The booking **write** path (`create_booking`) does NOT enforce the schedule/availability rules the
   **read** path (`available_slots`) advertises — and it has no rate limiting. _(Found independently by
   BOTH the security and database reviewers — the top finding.)_
2. Availability is computed in **Europe/Stockholm** but the booking instant is built in the **browser's
   local timezone** — wrong-instant bookings for non-Stockholm visitors.

Neither can corrupt overlap integrity or orphan a row (the exclusion constraint + FKs hold); they let
the system accept bookings the UI would never offer. These are **correctness/abuse bugs, not safety
bugs.** 285 tests pass but structurally cannot catch these (they encode the same assumptions the code
makes).

---

## HIGH

### H1 — `create_booking` enforces no schedule / working-hours / time-off rules (server-side) · [DB H1] + [SEC M-1] (convergent)

`supabase/migrations/20260623152741_functions.sql:40-78` (whole body — zero refs to `barber_schedules`/`barber_time_off`/`available_slots`).
`create_booking` checks only `start_at > now()` + method/contact pairing, then inserts. All schedule
intelligence lives in the advisory `available_slots` RPC (drives only the UI grey-out). The RPC is
`grant execute … to anon` and the anon key ships in the browser. **A direct anon call can create a
confirmed booking off-hours (03:00), outside 09–18, on a barber's day off / vacation, at arbitrary
minute offsets, with `price=0` and `duration_min=480`** — and a single 8-hour row blocks an entire
day via the exclusion constraint. Compounded by no rate limiting (M2) → scripted day-blocking DoS
across barbers/dates with attacker-supplied names (manual cleanup). The adapter comment
"let the DB exclusion constraint be the backstop" (`src/booking/adapters/supabaseBooking.ts:13-17`) is
incorrect: the constraint backstops _overlap only_, never schedule adherence; and on an availability
read error `availability()` returns `[]` so the UI offers all 12 slots.
**Fix:** Re-validate inside `create_booking` against `barber_schedules` + `barber_time_off` + the slot
grid (reuse `available_slots`' logic on Stockholm instants), bound `duration_min` to real service
durations, reject mismatched price/duration, return a dedicated `outside_hours` error. The single write
path should enforce what the read path advertises.

### H2 — Timezone mismatch: availability reasons in Europe/Stockholm, the INSERT uses the browser's local tz · [DB H2]

Availability: `supabase/migrations/20260623205456_admin_functions.sql:129-132` (`AT TIME ZONE 'Europe/Stockholm'`).
Insert: `src/booking/BookingFlow.tsx:456-462` builds `new Date(y,m,d,hh,mm)` (browser-local) → `src/booking/adapters/supabaseBooking.ts:45` sends `.toISOString()` → stored verbatim.
The instant availability reasons about and the instant stored agree **only when the visitor's browser
tz == Europe/Stockholm.** A customer booking from another tz (traveller/VPN/mis-set clock) stores a
different real instant than the `09:00` label they clicked, and can see availability/INSERT disagree
(`slot_taken` on a slot shown free, or vice-versa). **Does NOT break the overlap guarantee** (the
constraint operates on stored instants regardless), but books the wrong time.
**Fix:** Construct the booking instant in Europe/Stockholm — ideally server-side in `create_booking`
(send date + `HH:MM`, build with `AT TIME ZONE 'Europe/Stockholm'` exactly as `available_slots`), so
read + write share one definition of "09:00". (H1's fix naturally subsumes this.)

> Note: `send-confirmation` is a **latent HIGH** — it becomes a real one the moment a provider key is
> wired. Tracked as M3 below (it is benign today: no key → no send).

---

## MEDIUM

### M1 — `create_booking` no longer catches the bad-`barber_id` failure it documents (FK swap regression) · [DB M1]

`supabase/migrations/20260623152741_functions.sql:69-78` vs `…210000_bookings_barber_fk.sql:29-31`.
The exception block catches `exclusion_violation` + `check_violation` only. Migration 0009 replaced the
hardcoded `barber_id IN (...)` CHECK with a FK → a bad id now raises `foreign_key_violation` (23503),
unhandled → PostgREST 500 instead of the documented clean `{ok:false,error:'invalid'}`. Low
reachability (UI only sends roster ids) but a documented-intent regression on a public anon entry point.
**Fix:** Add `when foreign_key_violation then return …'invalid'` to the handler.

### M2 — No application-layer rate limiting / CAPTCHA on any anon RPC · [SEC M-3]

Absent across `src/`, `supabase/`, `vercel.json`. The `config.toml` `[auth.rate_limit]` governs only
Supabase Auth flows, NOT `create_booking`/`create_review`/`lookup_booking`/`taken_slots`. Enables
review spam (`create_review` inserts `published=true` immediately), the H1 booking-flood, and phone
enumeration (M4). Relies entirely on Supabase's coarse platform gateway.
**Fix:** CAPTCHA (hCaptcha/Turnstile — already referenced in `config.toml`) on booking + review submit,
and/or a per-IP/per-contact server-side cooldown.

### M3 — `send-confirmation` is a latent open SMS/email relay · [SEC M-2]

`supabase/functions/send-confirmation/index.ts:106-132` (recipient from POST body) + `:148-153`
(shared-secret check is a commented TODO) + `supabase/config.toml:397` (`verify_jwt=false`). Benign
today (no provider key → logs + `skipped`). **The instant `RESEND_API_KEY`/`ELKS_*` is set, the
deployed URL becomes a publicly-invokable endpoint sending to an attacker-chosen recipient** — message
cost + spam/phishing under the salon's identity. **Escalates to HIGH before any provider is wired.**
**Fix (launch blocker before providers):** enforce a `WEBHOOK_SECRET` header (fail-closed if unset) and
re-fetch the recipient from the `bookings` row by `record.id` (service-role) — never trust the posted
phone/email.

### M4 — Contact (phone/email) is the sole auth factor for read + cancel · [SEC M-4]

`supabase/migrations/20260623152741_functions.sql:124-205`. Knowing a victim's (non-secret) phone/email
lets anyone read their next appointment (time/barber/service/price + booking `id`) and silently cancel
it. Tests assert the wrong-contact→not_found path but never challenge the "contact is secret" premise.
Blast radius small for a barbershop (no payment/health data) → MEDIUM.
**Fix:** Add a lightweight ownership proof (one-time code to the contact channel) before lookup/cancel,
OR make an explicit, documented product decision to accept the model. If accepted, at least don't return
the booking `id` from `lookup_booking` without a second factor.

### M5 — `as unknown as WeekSchedule` double-cast ×5 (type hole, invariant-safe) · [CODE M1]

`src/admin/time.ts:87,98,108,115,127` (+ `src/admin/adapters/schedulesAdmin.ts:38`). `WeekSchedule` is a
7-tuple; `Array.map` types as `DaySchedule[]`, forcing a cast-through-`unknown` (load-bearing — `as
WeekSchedule` alone errors TS2352). Disables element-type checking; a future wrong-shape map wouldn't be
caught. Not a live bug (7-length invariant holds; consumers guard indexing).
**Fix:** Type `WeekSchedule = readonly DaySchedule[]` and delete the 5 casts, OR one element-checked
`asWeek()` helper.

### M6 — `mapsHref` literal hardcoded instead of `BUSINESS.mapsHref` · [CODE M2]

`src/booking/BookingFlow.tsx:385` byte-duplicates `src/config.ts:12`. `config.ts` is the documented
single source of truth for business facts; this fallback silently goes stale if the address changes.
**Fix:** Import `BUSINESS`, use `BUSINESS.mapsHref`.

### M7 — Duplicated label/date logic (3-4× each) · [CODE M3, M4]

(a) "Weekday D Month, HH:MM" formatter: `src/cancellation/adapters/supabaseCancellation.ts:34-45`,
`src/admin/views/BookingsView.tsx:39-51`, `src/cancellation/demoBooking.ts:66-73`,
`src/booking/BookingFlow.tsx:256` — `demoBooking` + `supabaseCancellation` must stay byte-identical (a
shared fn would guarantee it). (b) `YYYY-MM-DD` parsing: `BookingFlow.tsx:251`,
`src/booking/adapters/localCalendar.ts:69`, `src/admin/views/ScheduleView.tsx:554` — each with silent
fallbacks (malformed ISO → wrong date, not a typed failure; benign today as ISO is grid-sourced).
**Fix:** `formatWhenLabel(lang,date)` + `parseDateIso(iso): Date|null` in `calendar.ts`; replace all sites.

### M8 — Per-render inline-style object construction in large renders · [CODE M5]

`src/booking/BookingFlow.tsx:136-308`, `src/about/AboutSection.tsx:155-268` rebuild many
`JSX.CSSProperties` + object arrays every render → defeats child memoization, GC churn on theme/lang/
slot changes. Faithful port of the source model; not a correctness issue.
**Fix:** Hoist palette-only styles to module scope or `useMemo([c,dark])`; keep per-item styles inline.

---

## LOW

- **L1 — Unauthenticated occupancy oracle** · [SEC L-1] `…152741_functions.sql:102-118` (`taken_slots`),
  `…205456_admin_functions.sql:85-135` (`available_slots`): anon can read any barber's exact busy ranges.
  Inherent to a public calendar; lever is M2 (throttle).
- **L2 — Dead `taken_slots` surface** · [DB I2] + [CODE L1] `src/backend/rpcSchemas.ts:60-62` exports +
  the anon-granted `taken_slots` RPC have zero callers (superseded by `available_slots`).
  **Fix:** delete the schemas; drop/admin-scope the RPC grant.
- **L3 — `barber_id` FK added without an idempotency guard** · [DB L1] `…210000:29-31` (no `IF NOT
EXISTS`), unlike the guarded CHECK-drop above it. Clean push is fine (verified); only a manual
  single-migration re-run would error. **Fix:** guard with a `pg_constraint` existence check.
- **L4 — CSP `style-src 'unsafe-inline'`** · [SEC L-2] `vercel.json:14`. Not a script vector (no
  injection sink); defense-in-depth only. Acceptable given the inline-style architecture.
- **L5 — `parseRating` is an identity fn with a comment claiming narrowing** · [CODE L2]
  `src/about/reviewValidation.ts:17-19`. **Fix:** inline it + drop the misleading comment.
- **L6 — `BarbersView` hint paragraph mislabels its language to AT** · [CODE L3]
  `src/admin/views/BarbersView.tsx:386` tags always-Swedish text `lang="en"` in EN mode — a real a11y
  correctness defect for screen readers. **Fix:** hardcode `lang="sv"` (or translate).
- **L7 — `fill`/`fillMethod` token helpers duplicated; dead `{method}` branch** · [CODE L4]
  `src/about/AboutSection.tsx:52-53`, `src/cancellation/CancellationDialog.tsx:355-356`.
- **L8 — Internal (never-displayed) error-message language inconsistency** · [CODE L5]
  `src/about/reviews/adapters/supabaseReviews.ts:15` English vs Swedish elsewhere. Nil impact.
- **L9 — `.env` is tracked in git** · [SEC INFO] `.gitignore:13` ignores only `*.local`. Tracked content
  - full history contain only public config (verified — no credential ever committed). Future footgun.
    **Fix:** gitignore `.env`, keep only `.env.example` tracked.

---

## NITS (code hygiene — [CODE N1-N11])

- N1 truthy null-checks (`main.tsx:7`, `App.tsx:70`) vs the codebase's `=== null` discipline.
- N2 theme-color `<meta>` sync duplicated (`App.tsx:66-76` + `admin/useTheme.ts:31-42`), no unmount cleanup.
- N3 redundant type annotation `admin/views/AboutView.tsx:100`.
- N4 magic placeholder-id arrays rebuilt per render `about/AboutSection.tsx:275-276`.
- N5 `prefers-reduced-motion` sampled once, no re-subscribe (`GalleryMarquee.tsx:82`, Dialog). Edge.
- N6 marquee keyboard-focused tile keeps auto-scrolling (only selection pauses) `GalleryMarquee.tsx:217-221`. a11y polish.
- N7 import-time DOM side effect `ui/pseudo.ts:9-10` (deliberate, injection-safe; not a defect).
- N8 `!important` block `global.css:42-67` — justified (inline styles outrank classes; admin-scoped). Not slop.
- N9 coverage `include` (`vitest.config.ts:11-18`) understates reality — tested pure modules
  (`admin/time.ts`, `about/content/merge.ts`, `demoBooking.ts`, `reviewValidation.ts`) are excluded.
- N10 `reload` referenced in `[]`-dep effects (would trip exhaustive-deps, which isn't installed). Benign.
- N11 double announcement on login error region `admin/LoginPage.tsx:133-138`.

---

## Confirmed STRONG (do not regress these)

- **Double-booking impossible** [DB C1]: GiST exclusion correct (half-open `[)`, adjacency allowed,
  partial `WHERE status='confirmed'`, concurrency-safe); cancel frees the slot; availability overlap
  math agrees with the constraint; no orphan-row path.
- **Clean prod `db push` works** [DB C2]: monotonic timestamps, FK target exists before reference, guarded
  CHECK-drop, idempotent storage bucket/policies.
- **RLS / least-privilege boundary sound** [SEC Q1-3, DB C5]: anon cannot read PII (bookings/profiles);
  a barber cannot read/mutate another barber's data (proven); SECURITY DEFINER all `search_path=''` +
  schema-qualified + PUBLIC execute revoked; no enumeration of others' bookings.
- **`/admin` role is cosmetic only** [SEC Q4]: every capability re-checked by RLS from `auth.uid()`;
  forging `role:'owner'` in the browser grants zero DB privilege; no self-promote path on `profiles`.
- **No secrets in client/bundle** [SEC]: no `service_role`/`DB_URL` in `src/` or any `VITE_` var; built
  `dist/` has no secrets, no sourcemaps. Anon key public by design.
- **XSS closed, ICS/URL injection hardened, no ReDoS** [SEC]: escaped JSX, strict CSP, lint-enforced
  (`no-unsanitized`, `detect-unsafe-regex`); RFC5545 escaping + `encodeURIComponent` everywhere.
- **TS boundary + async discipline exemplary** [CODE, DB C6]: Zod-parse every response, never throw to
  UI, every effect race-guarded + cleaned up, supabase-js lazy off the public critical path, i18n parity
  compiler-enforced, pure domain core.

---

## Prioritized fix list (recommended order)

1. **H1** — Enforce schedule/time-off/hours inside `create_booking` (the public write path). _Top priority — found by 2 independent reviewers._
2. **H2** — Unify the booking-instant timezone to Europe/Stockholm (read + write share one definition).
3. **M3** — Gate `send-confirmation` with a fail-closed webhook secret + DB-sourced recipient **before** any provider key is set (launch blocker for that feature).
4. **M2 + M4** — Add CAPTCHA/throttle to booking+review; decide + document the contact-as-auth model (or add an OTP).
5. **M1** — Add the `foreign_key_violation` handler to `create_booking`.
6. **Code hygiene quick wins** — M6 (mapsHref), M7 (extract `formatWhenLabel`/`parseDateIso`), M5 (WeekSchedule cast), L2 (delete dead `taken_slots`), L6 (BarbersView `lang`).

_No CRITICAL. No HIGH live + exploitable today. Operate-as-is is sound; the list above is the path from "safe" to "beyond perfect"._
