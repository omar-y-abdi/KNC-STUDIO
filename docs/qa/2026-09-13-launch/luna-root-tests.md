# Luna root verifiering — 13 september 2026

Oberoende, read-only verifiering mot befintlig Wrangler-local på `http://127.0.0.1:8788` och
`dist` efter explicit `npm run build` (build grön, 13 s). Inga produktfiler, commits, deployer eller
produktionsmutationer gjordes av testagenten. Wranglerprocessen lämnades orörd.

## Pass

- `GET /privacy`, `/terms`, `/google-calendar`: HTTP 200; varje sida har exakt en `<h1>`, unik
  titel, description, canonical och robots-policy; inga `<script>` eller `#root`; rätt intern
  navigation. `google-calendar` är `noindex, nofollow`.
- `GET /404.html`, okänd `/root-test-missing-20260913`: HTTP 404 med dokumentet `Sidan finns inte`
  och `X-Robots-Tag: noindex, nofollow`; exakt en `<h1>`, inga script/root.
- `HEAD /`, `/privacy`, `/terms`, 404 och okänd path: rätt status och tom body.
- Canonical redirects: slash och `.html` för policy-/Google-sidan samt `/index.html` och privata
  slash-paths ger 308 och behåller query (`/privacy.html?from=root-test` →
  `/privacy?from=root-test`). Kundens 64-hex path ger 302 till fragment med `no-store`,
  `no-referrer`, `noindex` utan asset-fetch.
- Private GET `/login`, `/reset`, `/invite`, `/auth/confirm`, `/admin`, `/admin/settings`: HTTP 200,
  `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, routeunik `<title>`, ingen canonical.
  `/admin*` navigerar utan session till `/login` i browsern.
- Homepage source efter build: exakt en `id="root"` och en SSR-`<h1>` med readable fallback; efter
  Preact-rendering exakt en `#root` och en `<h1>` både vid desktop (default viewport) och 390×844
  mobile. `src/main.tsx:8-10` rensar SSR-fallbacken före `render`.
- `/sitemap.xml`: HTTP 200, inga `<lastmod>`, exakt canonical-locs för `/`, `/privacy`, `/terms`; alla
  tre mål svarar 200. `/robots.txt` pekar på canonical sitemap. `/llms.txt` innehåller alla tre
  canonical-länkar.
- Playwright static navigation: policy-/Google-sidor gav inga JS-, pageerror- eller consolefel.
  Browsern loggar på 404-dokument endast sin normala top-level `Failed to load resource … 404`.

## Fynd / blockers

1. **Private social metadata är stale.** `GET /login` (samma för `/reset`, `/invite`,
   `/auth/confirm`, `/admin*`) har rätt routeunik `<title>` och description, men behåller från
   `index.html` `og:title=Boka tid online`, `og:description=Välj barberare…`, och
   `og:url=https://bladeblendstudio.se/`. `renderPrivateMetadata()` i
   [`src/worker.ts`](../../src/worker.ts:234) uppdaterar bara title/description, tar bort canonical
   och sätter robots; den neutraliserar inte OG/Twitter-fälten. HTTP-repro:
   `curl -sS http://127.0.0.1:8788/login | rg -n -C 2 'og-title|og-description|og:url'`.
   Detta bryter sidunik social metadata och kan ge fel homepage-delning för privata URL:er.

2. **Local homepage console/network noise.** Browsern ser `POST /api/customer-bookings` → 503 när
   `/` laddas utan customer-cookie/konfigurerad local gateway (`src/app/App.tsx:132-138` anropar
   `defaultMyBookingsPort.list({ accessToken: '' ... })`). Det är inte ett JS/pageerror och de
   statiska sidorna skickar ingen sådan request, men launchkriteriet om helt felfri homepage-console
   kräver antingen konfigurerad gateway eller explicit bedömning av denna förväntade unauthenticated
   probe.

3. **Hostredirect ej livebevisad på Wrangler-local.** Unit-testet bekräftar `www` → apex 308
   (`tests/unit/workerRoutes.test.ts:110-120`). Wrangler-local normaliserar URL-host till loopback
   även med `--resolve`/`Host`, så en riktig HTTP-hostprobe på `:8788` gav inte ett giltigt bevis för
   `www`. Kräver riktig custom-domain/deployprobe.

## Artefakter

- `/tmp/knc-sep13-root-tests/root-http-check.mjs` — riktad Node HTTP-matris; gröna route/status/
  redirect/static/sitemap-checkar, exit 1 endast på de 18 stale-OG-assertionerna ovan.
- `/tmp/knc-sep13-root-tests/root-seo-browser.js` — Playwright source/hydration/static/private/
  sitemap-matris.
- `/tmp/knc-sep13-root-tests/root-seo-browser-postbuild.out` — verkligt browserresultat efter ny
  build; desktop/mobile h1/root-mätning samt console-events.
- `/tmp/knc-sep13-root-tests/root-http-check-postbuild.out` — verkligt HTTP-resultat efter ny build.

## Körda riktade kommandon

```text
npm run build
node /tmp/knc-sep13-root-tests/root-http-check.mjs
PWCLI=/Users/k/.codex/skills/playwright/scripts/playwright_cli.sh
"$PWCLI" --session=luna-root-seo-20260913b run-code --filename /tmp/knc-sep13-root-tests/root-seo-browser.js
```

## Backendgate — 13 september 2026

- `deno@2.9.5 check --frozen --node-modules-dir=manual` på samtliga 12
  `supabase/functions/*/index.ts`: PASS.
- `npx vitest run tests/unit/emailBusiness.test.ts tests/unit/externalActions.test.ts`:
  2 filer, 40 tester PASS. Mailtesterna täcker giltigt 2xx-UUID, malformed JSON/HTML 2xx,
  422/429/503/409 och transportfel; giltigt svar loggar endast provider-ID.
- Isolerad helperprobe `/tmp/knc-sep13-root-tests/background-task-probe.test.ts`:
  1 test PASS för returnerat originalresultat, resolve/reject och swallowed lifetime-observatör.
- Verklig lokal `supabase/edge-runtime:v1.74.3` probe med `Deno.serve` och planerad requester-abort
  efter 5 s: **BLOCKER**. Wrappern kraschade direkt före väntetiden; runtime hade ett
  `EdgeRuntime`-objekt men ingen `waitUntil`-funktion.
  `retainTaskUntilSettled` i `supabase/functions/_shared/backgroundTask.ts:4-13` kastade
  `TypeError: EdgeRuntime.waitUntil is not a function`; båda requesterna svarade omedelbart HTTP
  500, body `Internal Server Error`, och abort-after-5-s-livstidsvillkoret nåddes därför inte.
  Reproartefakter: `/tmp/knc-sep13-root-tests/lifetime-edge-stage-run`,
  `lifetime-*response`, `lifetime-*stderr`; container/image och egna serveprocesser stoppade
  efter probe. Detta är lokal EdgeRuntime-bevisning, inte deploybevisning.

### Backendfynd

1. **Lifetime-wrappern fungerar inte i lokal EdgeRuntime.** `typeof EdgeRuntime !== 'undefined'`
   räcker inte när objektet saknar `waitUntil`; guard måste kontrollera callable hook eller
   runtimeversionen/kontraktet måste säkras innan launch. Deno typecheck kan inte upptäcka detta
   globala runtimeformfel.
2. **Möjlig mail-PII i external-cleanup-logg.** `sendViaResend()` validerar UUID och loggar
   endast ID på lyckat svar (`supabase/functions/_shared/email.ts:483-498`), och
   `customer_email_link_send` ersätter leveransfelet med generisk text
   (`supabase/functions/_shared/externalActions.ts:799-807`). Men
   `customer_access_email_send` propagerar ett rått `error.message` från Resend
   (`externalActions.ts:847-854`), varefter `external-cleanup` skriver det till logg
   (`supabase/functions/external-cleanup/index.ts:114-119`). En providerfeltext som ekar
   mottagaradress eller annat mailinnehåll skulle därför loggas. Ingen liveprovider anropades.

## Backendkommandon

```text
npx --yes deno@2.9.5 check --frozen --node-modules-dir=manual <12 edge index.ts>
npx vitest run tests/unit/emailBusiness.test.ts tests/unit/externalActions.test.ts
npx --yes deno@2.9.5 test --no-config --no-lock /tmp/knc-sep13-root-tests/background-task-probe.test.ts
```

## Backend urgent gate — slutlig omprobe

- Efter callable-guard: verklig lokal EdgeRuntime v1.74.3 med 8 s jobb och 5 s requester-abort
  gav `curl` rc 28 efter exakt 5 s för både complete/fail; efter 4 s state var
  `{"started":2,"completed":1,"failed":1}`. En completion och en failure, inga dubbla körningar.
- `npx supabase migration up --local --yes` hade timeout-migrationen redan applicerad och tog
  även aktuell `20260913135548_tighten_private_calendar_grants.sql`; queue-funktionerna visar
  `timeout_30s=true` och ACL `postgres=X/postgres` oförändrad. Static body-jämförelse: alla tre
  funktioner lika utom `5000` → `30000`, exakt tre literals, inga grant/revoke.
- `deno@2.9.5 check --frozen --node-modules-dir=manual` för `external-cleanup` +
  `send-confirmation`: PASS. Riktade `emailBusiness` + `externalActions`: 2 filer, 40/40 PASS.
