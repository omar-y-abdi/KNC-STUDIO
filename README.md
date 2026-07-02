# KNC Studio — website

Production frontend for KNC Studio (barbershop, Göteborg). A faithful, hardened rewrite of the
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

| Script        | What it does                                               |
| ------------- | ---------------------------------------------------------- |
| `dev`         | Vite dev server with HMR                                   |
| `build`       | `tsc -b` (strict type-check) then `vite build` → `dist/`   |
| `preview`     | Serve the production build locally                         |
| `typecheck`   | `tsc -b` only                                              |
| `lint`        | ESLint (strict + security + no-unsanitized)                |
| `format`      | Prettier write                                             |
| `visual:gate` | Pixel-regression: build, screenshot, diff vs the baselines |

---

## Architecture

Effects live at the edges; the domain stays pure and referentially transparent.

```
src/
  main.tsx              # mount
  config.ts             # business facts + SITE_URL + injectable Clock (the only env/time reads)
  app/                  # App (state + responsive switch + theme-color/body-bg edge effect),
                        #   DesktopSite (editorial), MobileSite (M3 folding panel)
  booking/              # the booking domain:
    domain.ts           #   ADTs — invalid states unrepresentable
    pricing/slots/calendar.ts   # pure functions (no clock, no I/O)
    validation.ts       #   Zod + branded types (Name / Phone-SE / Email) → Result
    ics.ts              #   RFC5545-correct .ics builder (escaped, injection-safe)
    port.ts             #   BookingPort — the backend-ready seam (interface only)
    adapters/           #   localCalendarAdapter — the one concrete adapter (no network)
    BookingFlow + sub-components, bookingStyles
  i18n/                 # typed sv/en string tables (missing key = compile error)
  ui/                   # Dialog (accessible modal), pseudo (hover/focus helper)
tools/visual/           # pixel-regression harness (capture + compare) + baselines
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

The rewrite must render identically to the original prototype. `tools/visual/` screenshots both and
diffs them pixel-for-pixel:

```bash
node tools/visual/capture.mjs   # BASE=<url> OUT=<dir>  → desktop+mobile × light+dark × sv+en
node tools/visual/compare.mjs   # BASELINE vs CANDIDATE via pixelmatch; non-zero exit on drift
```

Chromium renders deterministically here (identical input → 0.000% mismatch), so any real visual
drift fails the gate. The build is confirmed byte-for-byte identical to the prototype across all
device × theme × language combinations.

---

## Backend-ready: adding a real adapter

The UI depends only on the `BookingPort` interface; submitting a booking flows through it. Today the
one implementation is `localCalendarAdapter` (no network — it produces the `.ics`, Google Calendar
and Maps links, exactly the prototype's behavior). To make bookings real, implement `BookingPort`
and inject it — **no UI changes required.** (These adapters are intentionally documented, not stubbed
in the source.)

```ts
// BookingPort: submit(booking: Booking): Promise<BookingResult>
```

**Option A — Supabase (free tier).** Create a `bookings` table, lock it down with Row-Level Security,
and write a `supabaseAdapter` that inserts the booking (anon key is public-by-design; RLS is the
guard) and returns the calendar links. Add the Supabase origin to the CSP `connect-src`.

**Option B — Calendar + salon phone via webhook + Apple Shortcuts.** A `webhookAdapter` POSTs the
booking to an endpoint (e.g. a serverless function) that adds the appointment to the barber's
calendar and notifies the salon phone; an Apple Shortcut on that phone then sends the customer the
SMS/email confirmation they chose. Add the endpoint origin to the CSP `connect-src`.

In both cases: validate server-side too (the client validation is UX, not enforcement), and keep any
secret on the server — never in this bundle.

---

## Deploy (Vercel)

1. Import the repo; framework preset **Vite** (build `npm run build`, output `dist`).
2. Set project env vars: `VITE_SITE_URL=https://<your-domain>` and `VITE_CLOCK=real`.
3. `vercel.json` applies the security headers automatically.
4. Add the custom domain (auto-HTTPS). Update `VITE_SITE_URL` to match so canonical/OG/sitemap are correct.

> `VITE_SITE_URL` feeds the canonical link, Open Graph/Twitter tags, sitemap and JSON-LD. It is
> parameterized — there are no hardcoded deployment URLs in the source.
