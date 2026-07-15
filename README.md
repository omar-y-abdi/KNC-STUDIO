# Blade & Blend Studio — website

Production frontend for Blade & Blend Studio (barbershop, Göteborg). A faithful, hardened rewrite of the
original single-file prototype into a real, deployable codebase. One responsive site: an editorial
desktop layout and a Material-style mobile layout, with an online booking flow.

- **Stack:** Vite + Preact + TypeScript (strict). No CDN — every dependency is pinned and bundled.
- **Hosting:** Vercel (static build + security headers via `vercel.json`).
- **Languages:** Swedish (default) + English. **Themes:** follows the device, with a manual toggle.

---

## Quick start

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check (tsc -b) + production build to dist/
npm run preview    # serve the built dist/ locally
```

### Scripts

| Script             | What it does                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `dev`              | Vite dev server with HMR                                                  |
| `build`            | `tsc -b` (strict type-check) then `vite build` → `dist/`                  |
| `preview`          | Serve the production build locally                                        |
| `typecheck`        | `tsc -b` only                                                             |
| `lint`             | ESLint (strict + security + no-unsanitized)                               |
| `format`           | Prettier write                                                            |
| `test`             | Vitest unit suite (pure domain modules)                                   |
| `test:integration` | Real adapters against a running local Supabase stack (skips if it's down) |

---

## Architecture

Effects live at the edges; the domain stays pure and referentially transparent.

```
src/
  main.tsx              # mount
  config.ts             # business facts + SITE_URL + injectable Clock (the only env/time reads)
  app/                  # Root (router) + App (state + responsive switch + theme edge effects),
                        #   DesktopSite (editorial), MobileSite (M3 folding panel)
  backend/              # env "configured?" check, lazy Supabase client seam, Zod RPC schemas
  booking/              # the booking domain:
    domain.ts           #   ADTs — invalid states unrepresentable
    pricing/slots/calendar.ts   # pure functions (no clock, no I/O)
    validation.ts       #   Zod + branded types (Name / Phone-SE) → Result
    ics.ts              #   RFC5545-correct .ics builder (escaped, injection-safe)
    port.ts             #   BookingPort — the backend seam (interface only)
    adapters/           #   localCalendarAdapter (offline mock) + lazy Supabase adapter
    BookingFlow + sub-components, bookingStyles
  about/                # About section: gallery, stylists, reviews (+ their ports/adapters)
  cancellation/         # phone-proven booking lookup + cancel flow (+ its ports/adapters)
  admin/                # staff panel (/login + /admin): schedules, bookings, barbers, content
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

- **Strict CSP** (via `vercel.json`): `default-src 'self'`, `script-src 'self'` (no inline/remote
  scripts), `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`
  (clickjacking), `upgrade-insecure-requests`. `style-src` allows `'unsafe-inline'` — a deliberate,
  documented trade-off: the design uses inline style attributes (Preact style objects); style
  injection is low-severity and **scripts remain locked to `'self'`**, which is the meaningful guard.
- **Security headers:** HSTS (preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, COOP, CORP.
- **No third-party runtime:** zero CDN, zero external scripts/fonts — everything is self-hosted and
  bundled from pinned deps, so there is no supply-chain surface and SRI is moot.
- **Input validation at the boundary:** all contact details pass Zod smart-constructors
  (`validation.ts`) before a `Booking` is produced. Branded types make a validated value
  impossible to confuse with a raw string.
- **Injection-safe output:** the `.ics` builder escapes per RFC5545 (the prototype concatenated
  unescaped commas — fixed); every dynamic URL part is `encodeURIComponent`-ed (no mailto/calendar
  header or parameter injection).
- **No secrets in the client.** `.env` holds only public config (`VITE_SITE_URL`, `VITE_CLOCK`).
- **Tooling gates:** `tsc` strict (no `any`, no `@ts-ignore`, exhaustive types), ESLint strict +
  `eslint-plugin-security` + `eslint-plugin-no-unsanitized` (DOM-sink XSS), Prettier.

---

## Pixel-parity gate

UI changes are guarded by a pixel-regression gate: `tools/visual/` screenshots a served build (run it
with `VITE_CLOCK=fixed` so the calendar is deterministic) and diffs it against the checked-in
baselines (`tools/visual/baseline/`) pixel-for-pixel:

```bash
node tools/visual/capture.mjs   # BASE=<url> OUT=<dir>  → desktop+mobile × light+dark × sv+en
node tools/visual/compare.mjs   # BASELINE vs CANDIDATE via pixelmatch; non-zero exit on drift
```

Chromium renders deterministically here (identical input → 0.000% mismatch), so any real visual
drift fails the gate.

---

## Backend: mock by default, Supabase when configured

The UI depends only on port interfaces (`BookingPort` and the reviews/cancellation/roster/content
ports); every backend action flows through them. With no `VITE_SUPABASE_*` env the app runs entirely
on the offline mock adapters (`localCalendarAdapter` & co. — bookings produce the `.ics`, Google
Calendar and Maps links locally; nothing is persisted). Setting `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` switches every port to the real Supabase adapters — lazy-loaded so
`supabase-js` stays out of the main bundle — with **no code change**. The full go-live checklist
(migrations, admin accounts, bot protection, SMS) is in `BACKEND.md`.

---

## Deploy (Vercel)

1. Import the repo; framework preset **Vite** (build `npm run build`, output `dist`).
2. Set project env vars: `VITE_SITE_URL=https://<your-domain>` and `VITE_CLOCK=real`.
3. `vercel.json` applies the security headers automatically.
4. Add the custom domain (auto-HTTPS). Update `VITE_SITE_URL` to match so canonical/OG/sitemap are correct.

> `VITE_SITE_URL` feeds the canonical link, Open Graph/Twitter tags, sitemap and JSON-LD. It is
> parameterized — there are no hardcoded deployment URLs in the source.
