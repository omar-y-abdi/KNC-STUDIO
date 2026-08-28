# Production real-life test — 2026-08-27

## Scope

- Target: `https://bladeblendstudio.se` and linked production Supabase/Resend/Google Calendar services.
- Source baseline: `main` at `f184f10fbe7f87f4510081552520bde0992e9aba`.
- Method: production UI journeys, network/console evidence, live gateway checks, provider/job evidence, and repository regression suites where they support a live claim.
- Data rule: use clearly marked test identities; record no raw personal data, bearer tokens, secrets, or booking details in this report.

## Status legend

- `PASS`: observed expected production behavior.
- `FIXED`: remediation applied and verified at the stated boundary.
- `PARTIAL`: one or more stated boundaries passed, but complete journey remains unverified.
- `FAIL`: reproducible product or operational failure.
- `BLOCKED`: required access/tool/provider state unavailable.
- `NOT RUN`: queued.

## Findings

### QA-001 — Encrypted production backup cannot start

- Severity: **High**
- Status: **BLOCKED — three of four required GitHub values configured**
- Evidence: GitHub Actions run `33073829199`, 2026-08-27 12:50 UTC.
- Observed: `Validate backup configuration` fails before backup creation. `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_STORAGE_SECRET_KEY`, and `BACKUP_AGE_RECIPIENT` are empty in job environment; first emitted error is `Missing SUPABASE_DB_URL secret`.
- History: recent scheduled backup runs on 2026-08-24, 2026-08-25, and 2026-08-26 also failed.
- Impact: no encrypted database/Storage artifact is produced; documented recovery control is inactive.
- Remediation completed: configured `SUPABASE_STORAGE_SECRET_KEY`, `SUPABASE_URL`, and `BACKUP_AGE_RECIPIENT`. Generated the offline identity at `/Users/k/.config/bladeblend-backup/bladeblend-backup.agekey` with mode `0600`; it must be copied to a second secure offline location.
- Remaining blocker: `SUPABASE_DB_URL` needs the existing production database password. No existing password was available in the exact macOS Keychain/`.pgpass` target, and production password rotation was explicitly excluded from the approved design. The workflow cannot produce a backup until this secret is set.

### QA-002 — External-action outbox never dispatches; requested Mina bokningar link is not received

- Severity: **High**
- Status: **PARTIAL — backend/provider handoff fixed; recipient journey not yet verified**
- Expected chain: UI `request_access` → `public-booking-actions` → token rotation → `customer_access_email_send` job → `external-action-dispatch` → `external-cleanup` → shared `executeExternalAction` → Resend.
- Observed: production contains a `customer_access_email_send` job created 2026-08-27 14:39 UTC. It remains `pending` with `attempt_count=0`, no `last_attempt_at`, and no error code despite the dispatcher running every minute.
- Root causes: Vault lacked `external_cleanup_url`, so `queue_due_external_actions()` returned `0`; after adding it, Vault `booking_webhook_secret` did not match Edge `WEBHOOK_SECRET`, so all seven dispatches returned `401 unauthorized`.
- Broader impact: the same queue has four pending `calendar_event_sync` jobs and two pending `calendar_event_delete` jobs, all with zero attempts. Customer access mail, normal Calendar create/update, Calendar deletion, Storage cleanup, and Auth lifecycle actions cannot dispatch.
- Remediation: created the Vault Function URL, rotated Edge/Vault webhook secrets to one value, and extended the production verifier to require all three Vault names plus SHA-256 webhook-secret parity without printing values or digests.
- Verification: all seven jobs were claimed; the customer-access email and all Calendar sync/delete jobs completed; `external_action_jobs` is empty. Resend accepted the customer-access email. Inbox placement still needs the controlled recipient/browser check.

### QA-007 — Confirmation handler trusts an unchecked legacy webhook secret

- Severity: **High operational / Low security**
- Status: **FIXED IN PRODUCTION**
- Observed: `send-confirmation` prefers `BOOKING_WEBHOOK_SECRET` when present, while the production verifier proves Vault parity only against canonical `WEBHOOK_SECRET`.
- Live evidence: production still contains the legacy secret name and its digest differs from canonical `WEBHOOK_SECRET`; no value or digest was printed. The verifier therefore passed while booking confirmation/reminder dispatch could return `401`.
- Security impact: a stale credential remains accepted by an internet-reachable `verify_jwt=false` handler. Exploitation additionally requires possession of the stale value and a valid booking/delivery UUID.
- Remediation: deployed `send-confirmation` version 44, which accepts only `WEBHOOK_SECRET`; removed production `BOOKING_WEBHOOK_SECRET`; contract tests include every shared-secret handler; production verification rejects the legacy alias entirely.
- Verification: live preflight passed all nine Edge names, three Vault names, legacy-secret absence, and canonical digest parity. Server-side Vault probe request `472` reached the handler and returned `404 booking_not_found`, not `401`, proving authentication without creating a booking or sending customer mail.

### QA-008 — Integration suite contaminates later database tests

- Severity: **Medium test reliability**
- Status: **FIXED ON BRANCH**
- Observed: running integration tests before pgTAP left four bookings, two reviews, one recurring break, and modified service weekdays in the local database. Later pgTAP failed with overlap/count errors unrelated to production code.
- Root causes: the recurring-availability integration test did not restore its service/break mutations, and global integration teardown removed Auth identities but did not clear booking/review fixtures.
- Remediation: the mutating test restores exact prior weekdays and deletes its test break in `finally`; global teardown clears all shared booking/review/access/break fixtures.
- Verification: after a clean reset, integration passed 40/40; readback returned zero bookings, reviews, and recurring breaks with seed weekdays restored; the immediately following pgTAP run passed 803/803.

### QA-003 — In-app Browser control unavailable in current agent session

- Severity: **Test-environment blocker; not product defect**
- Status: **BLOCKED**
- Observed: Browser plugin skill is installed, but required `node_repl js` control tool is not exposed after discovery. Explicit Browser selection prevents substitution with another browser surface.
- Impact: visible UI, authenticated browser session, console/network, responsive and accessibility journeys cannot start until connection is restored.

### QA-004 — HSTS preload documentation does not match deployed header

- Severity: **Low**
- Status: **FIXED ON BRANCH — pending merge/deploy**
- Expected: README states HSTS preload posture.
- Observed: deployed and checked-in header is `Strict-Transport-Security: max-age=31536000; includeSubDomains`; `preload` directive is absent.
- Impact: documentation overstates deployed policy. Header still enforces one-year HSTS with subdomains.
- Remediation: README now documents the deployed one-year HSTS-with-subdomains policy instead of claiming preload enrollment.

### QA-005 — Anonymous callers can execute privileged reminder RPCs

- Severity: **Medium**
- Status: **FIXED ON BRANCH — pending migration deployment**
- Observed: live ACL grants both `anon` and `authenticated` direct execute on `SECURITY DEFINER` functions `mark_booking_reminder_delivered(uuid)` and `queue_due_booking_reminders()`.
- Concrete impact: `mark_booking_reminder_delivered()` has no caller authorization and sets `delivered_at` for a supplied booking UUID. A caller who obtains a booking UUID can suppress its customer reminder. `queue_due_booking_reminders()` can invoke up to 50 external reminder dispatches, although due-window checks, row locks, and delivery idempotency limit abuse.
- Root cause: original migrations revoke from `PUBLIC`, but hosted Supabase function ACLs contain explicit `anon` and `authenticated` grants. Effective ACL is authoritative.
- Related lower-risk exposure: trigger/event functions `queue_booking_confirmation()`, `queue_booking_reminder_after_insert()`, and `rls_auto_enable()` also retain public role execute grants; trigger return types reduce direct RPC exploitability.
- Remediation: forward-only migration explicitly revokes `public`, `anon`, `authenticated`, and unnecessary `service_role` grants; restores only authenticated admin cancellation and service-role reminder completion. New pgTAP coverage asserts all effective ACLs.

### QA-006 — Supabase leaked-password protection is disabled

- Severity: **Medium**
- Status: **BLOCKED — paid Supabase plan required**
- Evidence: live Supabase Security Advisor `auth_leaked_password_protection` warning.
- Impact: staff/admin password policy checks complexity, but Auth does not reject known-compromised passwords.
- Blocker: current Supabase documentation states leaked-password protection requires Pro or above; this project is operated under the documented Free-plan constraints. Enabling it requires an explicit paid-plan upgrade. Existing 12-character mixed-character policy and current-password verification remain active.

## Test matrix

| ID     | Area              | Journey / assertion                                                        | Status  | Evidence / notes                                                                         |
| ------ | ----------------- | -------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| PUB-01 | Routing           | Apex loads; `www` redirects to apex; no redirect loop                      | PASS    | Apex 200/TLS valid; www 308 to apex                                                      |
| PUB-02 | Homepage          | Desktop Swedish content, live business data, roster, services              | NOT RUN |                                                                                          |
| PUB-03 | Homepage          | Mobile Swedish layout, scroll, navigation, folding panels                  | NOT RUN |                                                                                          |
| PUB-04 | i18n              | Swedish ↔ English preserves current view and complete copy                 | NOT RUN |                                                                                          |
| PUB-05 | Theme             | System/manual light-dark behavior; readable controls/content               | NOT RUN |                                                                                          |
| PUB-06 | Privacy           | Consent banner disclosure, accept/reject/preferences persistence           | NOT RUN |                                                                                          |
| PUB-07 | About             | Live CMS content, gallery, real published reviews; no seeded fake reviews  | NOT RUN |                                                                                          |
| PUB-08 | Contact           | Phone, email, address, map links use current CMS values                    | NOT RUN |                                                                                          |
| PUB-09 | Discovery         | `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/.well-known/acp.json`        | PASS    | All 200 with expected content types/content                                              |
| PUB-10 | SEO               | Canonical, language/social metadata, JSON-LD and no accidental `noindex`   | PASS    | Canonical apex; index/follow; OG/Twitter; valid HairSalon JSON-LD                        |
| BKG-01 | Booking           | Live roster/services load without frontend fallback data                   | PASS    | Public catalog RPC returns active barber/service pair                                    |
| BKG-02 | Booking           | Availability honors server catalog and returns valid future slots          | PASS    | Live RPC returned HH:MM slots for catalog duration                                       |
| BKG-03 | Booking           | Validation rejects malformed payload and email                             | PASS    | Gateway 400 for empty payload and malformed email                                        |
| BKG-04 | Booking           | Turnstile gateway fails closed for missing challenge                       | PASS    | Submit and public-action gateways return `failed_challenge`                              |
| BKG-05 | Booking           | Complete controlled booking; price/duration/name match server catalog      | NOT RUN |                                                                                          |
| BKG-06 | Booking           | Confirmation UI, ICS, Google Calendar link contain correct local time      | NOT RUN |                                                                                          |
| BKG-07 | Email             | Customer and linked barber each receive exactly one confirmation           | NOT RUN | Provider ledger passed; recipient inbox receipt not yet tested                           |
| BKG-08 | Calendar          | Google event created for linked barber; no duplicate on retry              | NOT RUN | Provider jobs completed; Google event/readback and retry dedupe not yet tested           |
| MYB-01 | Mina bokningar    | Request fresh link with booking email                                      | NOT RUN | Backend job and Resend acceptance passed; UI request and recipient inbox remain untested |
| MYB-02 | Mina bokningar    | Fresh random root-path link opens scoped bookings directly                 | NOT RUN |                                                                                          |
| MYB-03 | Mina bokningar    | Rotated previous link is rejected as replaced/expired                      | NOT RUN |                                                                                          |
| MYB-04 | Mina bokningar    | Another customer's booking cannot be listed/cancelled                      | NOT RUN |                                                                                          |
| MYB-05 | Mina bokningar    | Eligible cancellation succeeds and disappears from upcoming list           | NOT RUN |                                                                                          |
| MYB-06 | Email             | Customer and barber each receive one cancellation message                  | NOT RUN |                                                                                          |
| REV-01 | Reviews           | Ineligible identity rejected without data leakage                          | NOT RUN |                                                                                          |
| REV-02 | Reviews           | Eligible completed booking can submit once; moderation state correct       | NOT RUN |                                                                                          |
| ADM-01 | Admin auth        | Invalid login, valid owner/barber login, logout, route protection          | NOT RUN |                                                                                          |
| ADM-02 | Admin auth        | Recovery, invitation, email-change, password-change flows                  | NOT RUN |                                                                                          |
| ADM-03 | Admin state       | Selected tab/draft/edit state survives literal reload as designed          | NOT RUN |                                                                                          |
| ADM-04 | Bookings          | Owner/barber scopes; manual booking; cancel/delete/history operations      | NOT RUN |                                                                                          |
| ADM-05 | Schedule          | Weekly schedule, recurring breaks, time off, slot blocks, conflict dialogs | NOT RUN |                                                                                          |
| ADM-06 | Services          | Create/edit/disable/delete; weekday availability; validation               | NOT RUN |                                                                                          |
| ADM-07 | Barbers           | Create/invite/edit/disable/delete guards and account state                 | NOT RUN |                                                                                          |
| ADM-08 | CMS               | Site/contact/SEO/logo draft-preview-publish and live public reflection     | NOT RUN |                                                                                          |
| ADM-09 | About/media       | Copy, gallery/profile image upload/replace/delete and processed output     | NOT RUN |                                                                                          |
| ADM-10 | Mail              | Template edit/publish/placeholders; resulting controlled email             | NOT RUN |                                                                                          |
| ADM-11 | Calendar          | Connect/status/sync/disconnect and durable deletion cleanup                | NOT RUN |                                                                                          |
| OPS-01 | CI                | Current `main` CI                                                          | PASS    | Run `33073100772`, head `f184f10`                                                        |
| OPS-02 | Backup            | Encrypted database + Storage backup completes                              | BLOCKED | QA-001: only `SUPABASE_DB_URL` remains                                                   |
| OPS-03 | Headers           | CSP, HSTS, frame, MIME, referrer, permissions, COOP/CORP                   | PASS    | Deployed headers present; documentation corrected by QA-004                              |
| OPS-04 | Quality           | Console errors, failed requests, keyboard/focus, responsive overflow       | BLOCKED | QA-003                                                                                   |
| OPS-05 | Supabase security | Effective grants and live Security Advisor                                 | FAIL    | QA-005 and QA-006                                                                        |
| OPS-06 | Email DNS         | SPF, DKIM, DMARC and mail MX publicly resolve                              | PASS    | Provider dashboard status/inbox placement not proven                                     |
| OPS-07 | Performance       | Apex HTTP response latency from current test location                      | PASS    | 20 samples: 85 ms average, 123 ms p95, 142 ms max                                        |
| OPS-08 | Test isolation    | Integration teardown restores shared local database state                  | PASS    | Zero leaked bookings/reviews/breaks; subsequent pgTAP passed 803/803                     |
| INT-01 | Delivery boundary | Customer-access job reaches Resend provider                                | PASS    | Durable job completed and Resend accepted request                                        |
| INT-02 | Durable outbox    | External-action backlog dispatches and drains                              | PASS    | Seven queued jobs completed; final `external_action_jobs` count zero                     |

## Chronological evidence log

### 2026-08-27

- 12:41 UTC — PR #18 merged into PR #17 branch; PR #17 then merged into `main` as `f184f10`. Final stacked code is present in `main`.
- 12:41 UTC — CI run `33073100772` completed successfully on `f184f10`.
- 12:50 UTC — Encrypted production backup run `33073829199` failed at configuration validation; no backup steps ran. Logged as QA-001.
- Browser bootstrap — Browser control capability missing from current session. Logged as QA-003; no substitute browser used.
- User-reported fresh Mina bokningar link nondelivery logged as QA-002 pending controlled reproduction.
- 15:12 UTC — Apex/TLS/www redirect, public/private route policy, discovery files, static assets, canonical/OG/Twitter and JSON-LD live-smoke passed. HSTS preload mismatch logged as QA-004.
- 15:14 UTC — Live Supabase smoke passed 6/6: catalog/slots, payload validation, Turnstile fail-closed behavior, public-action gateway, and contracted anon RPC denial.
- 15:16 UTC — All local migrations match remote through `20260824092548`; 13 expected Edge Functions are ACTIVE; all nine required Edge secret names exist.
- 15:16 UTC — QA-002 root cause confirmed: Vault lacks `external_cleanup_url`; customer-access and Calendar jobs remain pending with zero attempts while active pg_cron dispatcher returns successfully every minute.
- 15:19 UTC — Cloudflare Worker version 79 confirmed at 100%; all 17 local `main` build assets byte-match production. Six-hour Worker telemetry has zero recorded errors and zero 5xx responses. DNSSEC is active; Turnstile widget is restricted to apex production domain.
- 15:23 UTC — Local gates: production dependency audit 0 vulnerabilities, ESLint pass, 406/406 unit tests pass, build and Wrangler dry-run pass. Local Deno is unavailable; current `main` Edge Function CI is green.
- 15:24 UTC — Live email delivery ledger shows all four confirmation and all four cancellation jobs completed with both customer and barber recipient kinds. Public SPF/DKIM/DMARC/MX records resolve.
- 15:25 UTC — Live Supabase Advisor/effective ACL review logged QA-005 and QA-006. No mutating exploit call was made.
- 15:27 UTC — Public CMS/RLS smoke passed: every required business setting is non-empty; Swedish and English site/about rows exist; catalog has one active barber/service pair. Production currently has zero published reviews and zero gallery images, matching the fake-data removal posture.
- 15:28 UTC — Synthetic 64-hex customer route redirects into a noindex fragment; 63-hex path returns 404. Invalid access token returns `access_denied`; unapproved public-action Origin returns 403.
- 15:29 UTC — TLS certificate covers apex and `www`, valid 2026-08-09 through 2026-11-07. Homepage latency over 20 requests: 85 ms average, 123 ms p95, 142 ms max.
- 17:05 UTC — Added Vault `external_cleanup_url`; production preflight then passed all nine Edge and three Vault secret-name checks. Seven queued actions were claimed but returned 401, proving webhook-secret drift.
- 17:10 UTC — Rotated Edge `WEBHOOK_SECRET` and Vault `booking_webhook_secret` to one unlogged value. Six actions completed immediately; one transient Calendar delete retried and completed. Final outbox count: zero.
- 17:14 UTC — Production preflight extended with SHA-256 webhook-secret parity; live verifier passed without printing values/digests.
- 17:16 UTC — Local branch verification: 409 unit tests, 803 pgTAP assertions, 40 adapter integration tests, ESLint, Prettier, production build, and Wrangler dry-run passed.
- Backup remediation — Storage secret and both public variables configured in GitHub. `SUPABASE_DB_URL` remains blocked on an unavailable existing password; no production password rotation performed. Offline age identity stored at the path recorded in QA-001.

### 2026-08-28

- Hostile review — confirmed production `BOOKING_WEBHOOK_SECRET` exists with a different digest from canonical `WEBHOOK_SECRET` while preflight passes. Logged QA-007; no secret value or digest printed.
- Security diff scan `e95940fc-33ae-49ca-9081-9b7090f55a87` validated the stale-credential path as Low security severity/high confidence; separate operational impact remains High because booking mail/reminders can fail for every dispatch.
- Test isolation — reproduced pgTAP failures only after integration, traced leaked fixtures, added exact and global teardown, then verified integration 40/40 → clean state readback → pgTAP 803/803. Logged QA-008.
- Production hotfix — CI run `33141989649` passed all jobs on `27e23f6`; deployed `send-confirmation` v44, removed legacy `BOOKING_WEBHOOK_SECRET`, and reran production preflight successfully.
- Vault auth probe — `pg_net` request `472` used Vault-held URL/secret and returned expected `404 booking_not_found` with no timeout. This distinguishes successful authentication from prior `401` failures without touching a real booking or recipient.
