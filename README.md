# Blade & Blend Studio — website

Production frontend for Blade & Blend Studio (barbershop, Göteborg). A faithful, hardened rewrite of the
original single-file prototype into a real, deployable codebase. One responsive site: an editorial
desktop layout and a Material-style mobile layout, with an online booking flow.

- **Stack:** Vite + Preact + TypeScript (strict). No CDN — every dependency is pinned and bundled.
- **Hosting:** Cloudflare Workers Static Assets (`wrangler.jsonc` + `public/_headers`).
- **Languages:** Swedish (default) + English. **Themes:** follows the device, with a manual toggle.

---

## Quick start

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check (tsc -b) + production build to dist/
npm run preview    # serve the built dist/ locally
```

### Local customer links and cookies

Vite serves the UI. Customer history needs the real Worker and Edge Function too. Both `dev` and
`preview` proxy `/api/bookings`, `/api/customer-bookings` and 64-character customer root links to the loopback Worker
at `http://127.0.0.1:8787`. Override with `CUSTOMER_GATEWAY_PROXY_URL`; external origins are rejected.
Host/Origin remain the browser's values so the Worker still enforces same-origin requests.

For repeatable local verification:

```bash
# Local test values only. This file is ignored by git.
cat > supabase/functions/.env <<'EOF'
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
PUBLIC_ACTION_HASH_SALT=ci-public-action-hash-salt-not-for-production
CUSTOMER_GATEWAY_SECRET=ci-customer-gateway-secret-not-for-production
IP_SALT=ci-booking-ip-salt-not-for-production
PUBLIC_SITE_ORIGINS=http://127.0.0.1:4173,https://127.0.0.1:4197
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EOF
npx supabase start
npm run test:e2e -- --customer
```

Use a dedicated local Supabase stack. Preserve any existing local Function env values when adding
these settings; restart/serve Functions after changing them. The gate requires current migrations
and installed Playwright Chromium, Firefox and WebKit (`npx playwright install --with-deps`). It
builds the app in a temporary directory, starts an HTTPS Worker and Vite preview, creates isolated
customer fixtures, tests actual cookies/profile switching/rotation, and removes its fixtures and
servers. It sends no provider email and rejects non-loopback database/API addresses. Logs and failed
screenshots remain in the printed temporary directory.

For interactive development, configure `.env.local` with the local `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` from `npx supabase status`. Put the local `SUPABASE_URL`, `SUPABASE_ANON_KEY`
and matching `CUSTOMER_GATEWAY_SECRET` in ignored `.dev.vars`; add the exact Vite origin to the local
Edge `PUBLIC_SITE_ORIGINS`. Start `npm run cloudflare:dev -- --local --ip 127.0.0.1 --port 8787` in one
terminal and `npm run dev` in another. Preview uses the same proxy after `npm run build`.

Cookie acceptance must also be tested with HTTPS. Vite accepts certificate paths in `LOCAL_HTTPS_KEY`
and `LOCAL_HTTPS_CERT`; both are required. Run Wrangler with matching HTTPS protocol/certificate and
set `CUSTOMER_GATEWAY_PROXY_URL` accordingly. For HTTPS UI with HTTP local Supabase, set
`LOCAL_SUPABASE_URL=http://127.0.0.1:54321` and build with
`VITE_SUPABASE_URL=https://127.0.0.1:<vite-port>/__supabase`. This local TLS bridge avoids WebKit's
mixed-content rejection and strips Cookie/Set-Cookie while preserving Supabase bearer auth.
Production routing and cookie policy are unchanged.

### Scripts

| Script             | What it does                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `dev`              | Vite dev server with HMR                                                  |
| `build`            | `tsc -b` (strict type-check) then `vite build` → `dist/`                  |
| `preview`          | Serve the production build locally                                        |
| `deploy`           | Build and deploy static assets to Cloudflare                              |
| `deploy:dry-run`   | Build and validate Cloudflare deployment without publishing               |
| `cloudflare:dev`   | Build and serve through Wrangler locally                                  |
| `typecheck`        | `tsc -b` only                                                             |
| `lint`             | ESLint (strict + security + no-unsanitized)                               |
| `format`           | Prettier write                                                            |
| `test`             | Vitest unit suite (pure domain modules)                                   |
| `test:integration` | Real adapters against a running local Supabase stack (skips if it's down) |

---

## Architecture

Effects live at the edges; the domain stays pure and referentially transparent.
[CODEBASE-MAP.md](CODEBASE-MAP.md) is the complete architectural index of the repo.

```
src/
  main.tsx              # mount
  config.ts             # business facts + SITE_URL + injectable Clock (the only env/time reads)
  app/                  # Root (router) + App (state + responsive switch + theme edge effects),
                        #   DesktopSite (editorial), MobileSite (M3 folding panel)
  backend/              # env "configured?" check, lazy Supabase client seam, Zod RPC schemas
  booking/              # the booking domain:
    domain.ts           #   ADTs — invalid states unrepresentable
    calendar.ts         # pure calendar/date functions (no I/O)
    slotPacking.ts      # pure offline/mock slot packing (live availability is DB-owned)
    validation.ts       #   Zod + branded types (Name / Phone-SE) → Result
    ics.ts              #   RFC5545-correct .ics builder (escaped, injection-safe)
    port.ts             #   BookingPort — the backend seam (interface only)
    adapters/           #   localCalendarAdapter (offline mock) + lazy Supabase adapter
    BookingFlow + sub-components, bookingStyles
  about/                # About section: gallery, DB-driven stylists, reviews (+ ports/adapters)
  mybookings/           # permanent email-token history/cancel + first-party HttpOnly session
  admin/                # staff panel: operations + authenticated email/password settings
  i18n/                 # typed sv/en string tables (missing key = compile error)
  ui/                   # Dialog (accessible modal), pseudo (hover/focus helper)
tools/visual/           # pixel-regression harness (capture + compare) + baselines
supabase/               # migrations (schema, RLS, RPCs), edge functions, pgTAP tests, seed
public/                 # fonts (self-hosted), icons, robots.txt, sitemap.xml, llms.txt, og image
```

### The clock is injectable

The booking calendar's "today" comes from a `Clock` (`config.ts`), never a bare `new Date()`:

- **production** → `realClock` (the calendar tracks the real current day).
- **visual-regression** → `fixedClock` (`2026-06-19`, the original prototype's day) so screenshots
  are deterministic and match the baseline exactly. Selected by `VITE_CLOCK=fixed`.

---

## Security posture

This is a static frontend. **Client code is always inspectable** — minification + no shipped
sourcemaps raises the bar to read it, but nothing in a browser is truly "unbreakable." Real
enforcement (a booking that cannot be abused) requires a backend; this repo is structured to add one
without a rewrite (see below). What _is_ hardened here:

- **Strict CSP** (via `public/_headers`): `default-src 'self'`, restricted script/connect/frame hosts,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`
  (clickjacking), `upgrade-insecure-requests`. `style-src` allows `'unsafe-inline'` — a deliberate,
  documented trade-off: the design uses inline style attributes (Preact style objects); style
  injection is low-severity and **scripts remain locked to `'self'`**, which is the meaningful guard.
- **Security headers:** one-year HSTS with subdomains, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, COOP, CORP.
- **Restricted third-party runtime:** app code and fonts are self-hosted; CSP allows only Supabase and
  Cloudflare Turnstile endpoints required by booking and authentication.
- **Input validation at the boundary:** all contact details pass Zod smart-constructors
  (`validation.ts`) before a `Booking` is produced. Branded types make a validated value
  impossible to confuse with a raw string.
- **Injection-safe output:** the `.ics` builder escapes per RFC5545 (the prototype concatenated
  unescaped commas — fixed); every dynamic URL part is `encodeURIComponent`-ed (no mailto/calendar
  header or parameter injection).
- **No secrets in the client.** `.env` holds only public `VITE_*` config. Resend, Turnstile secret,
  webhook secret, and Supabase service-role key stay server-side.
- **Tooling gates:** `tsc` strict (no `any`, no `@ts-ignore`, exhaustive types), ESLint strict +
  `eslint-plugin-security` + `eslint-plugin-no-unsanitized` (DOM-sink XSS), Prettier.

---

## Pixel-parity gate

UI changes are guarded by a pixel-regression gate: `tools/visual/` screenshots a served build (run it
with `VITE_CLOCK=fixed` so the calendar is deterministic) and diffs it against the checked-in
baselines (`tools/visual/baseline/`) pixel-for-pixel:

```bash
node tools/visual/capture.mjs   # BASE=<url> OUT=<dir>  → 8 homepage variants
node tools/visual/compare.mjs   # BASELINE vs CANDIDATE via pixelmatch; non-zero exit on drift
```

Chromium renders deterministically here (identical input → 0.000% mismatch), so any real visual
drift fails the gate.

---

## Backend: Supabase-owned business catalog

The UI depends only on port interfaces. Production requires `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY`. Roster, profile photos, and services preload through one cached
`public_booking_catalog()` request and invalidate through Realtime; frontend constants never paint
named barbers or services. The catalog carries each service's weekday set; the client date-filters
the menu and asks the service-aware availability RPC, while booking writes recheck the same rule.
An unconfigured build shows honest empty catalog/history states and persists nothing. See `BACKEND.md`
for go-live requirements.

Customer confirmation/reminder email contains the current permanent, email-scoped Mina bokningar
link. Requesting a fresh link rotates it and invalidates the prior link. Transactional email covers
confirmations and cancellations for customer + barber. Supabase Cron
queues a customer-only reminder one day before start time, but only for bookings created at least
24 hours in advance; Resend idempotency and a delivery ledger prevent duplicates.

The permanent root-path link remains the customer entry point. The Worker redirects that link into the
app, and the browser uses same-origin `/api/customer-bookings`; the Worker signs origin, timestamp, IP,
and body with `CUSTOMER_GATEWAY_SECRET` before forwarding to the Edge gateway. Valid access receives a
first-party HttpOnly `SameSite=Lax` session cookie. The browser never stores the token in
`sessionStorage`/`localStorage`, and no phone-memory cookie authorizes access. Current local code does not
change production until deployed. Optional functional storage adds a separate, server-issued receipt
for newly created booking IDs only. It does not authenticate the entered contact or expand into old
history. Rejecting/withdrawing optional storage preserves the essential email-link session.

Current release order and rollback: [customer device access](docs/operations/CUSTOMER_DEVICE_ACCESS_2026-09-11.md).

---

## Deploy (Cloudflare)

1. Authenticate Wrangler: `npx wrangler login` or set `CLOUDFLARE_API_TOKEN`.
2. Verify without publishing: `npm run deploy:dry-run`.
3. Publish: `npm run deploy`.
4. `wrangler.jsonc` attaches `bladeblendstudio.se` and `www.bladeblendstudio.se` as Custom Domains;
   canonical metadata points to apex. `_headers` applies CSP/security/cache headers to static assets.

> `VITE_SITE_URL` feeds the canonical link, Open Graph/Twitter tags, sitemap and JSON-LD. It is
> fixed to `https://bladeblendstudio.se` for production.
