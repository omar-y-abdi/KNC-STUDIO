# CMS business identity — 2026-09-13

Implemented in existing SiteView/site_settings: optional legal business name and Swedish registration number, blank defaults, existing owner-only RLS, trim/length/control-character/number-format validation through the existing trigger. Number format validation does not verify company registration.

Migration: `20260913145001_cms_legal_business_identity.sql`; adds both keys to the existing discovery whitelist. JSON-LD emits legalName/identifier only when supplied. Existing contact/address/catalog/schedule/service settings remain the shared source.

Worker renders `/terms` and `/privacy` identities and contacts into HTML, with the numeric cancellation policy on terms. Both languages use saved data. No-store and stripped conditional validators prevent stale legal assets; a discovery failure retains generic text without invented company/contact values. Alias canonicalization, one h1, unknown 404 and private noindex remain in their existing paths.

Verification delegated to PM/Luna (not run by this agent):

- `npx vitest run tests/unit/businessStructuredData.test.ts tests/unit/workerRoutes.test.ts tests/unit/siteChrome.test.ts tests/unit/bookingLinks.test.ts`
- `npm run typecheck` and focused ESLint on touched TS/TSX.
- Apply the migration locally, then `psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/cms_legal_business_identity_test.sql` (15 pgTAP assertions, rolled back). Run existing discovery/CMS pgTAP tests as regression coverage.
- Browser/HTTP: owner save/reload legal fields; barber denied editing; inspect GET source of terms/privacy for saved name, registration number, address/email and current cancellation hours; change then reload without stale values; clear legal fields and confirm omitted; HEAD empty/no-store, aliases 308, unknown 404, private noindex. No production mutation performed.

No App.tsx change. Existing test business literals in bookingLinks/workerRoutes gained the two required empty/synthetic fixture properties; these are test fixtures, never public defaults. Formatting completed with Prettier.

Follow-up verification 16:56 local: exact four-file Vitest gate passed **58/58**, 4/4 files. Initial failures identified two stale full-model expectations and a real formatted-HTML bug: whitespace before span tag delimiters prevented contact replacement. Both the shared rendering patterns and complete settings expectations were corrected; tests render the actual formatted checked-in HTML.
