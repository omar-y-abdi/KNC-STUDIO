# PR #58 adversarial solo review

## Scope and constraints

- Requested outcome: assess all PR work against full website launch readiness; report every supported weakness with source proof to GitHub.
- Read-only review. No application code execution, test execution, builds, deployments, repository/product edits, or subagents. Only this Markdown review record may change locally. Final GitHub review comments are explicitly authorized.
- Repository: `omar-y-abdi/KNC-STUDIO`; PR: https://github.com/omar-y-abdi/KNC-STUDIO/pull/58
- Pinned head: `5b45a09c44ce32fd64be724e4855d96273583004`; base: `88ab39a156adf58da65ad477999040288beae941`.
- GitHub initial metadata: open, not draft, eight commits, 59 changed files, +2649/-498.
- Existing untracked user files: `AGENTS.md`, `docs/qa/2026-08-31-github-issues-review.md`. Preserve.
- Review skill's parallel-agent steps overridden by explicit solo constraint. Test-running instructions overridden by explicit static-only scope.
- Read operations use GitHub connector and shell file/git inspection; no product code runs. Furl guidance read: compressed summaries cannot establish exhaustive coverage; inspect raw source.

## Independent work packages

| Package | Input | Output | Independent check |
| --- | --- | --- | --- |
| Scope/history | PR description, comments, every commit, file manifest | Fixed review boundary and claimed outcomes | Compare live GitHub SHAs, manifest and local object inventory |
| Customer security | Browser, Worker, Edge, migrations, tests | Authorization, rotation, cookie and rate-limit findings | Trace concrete requests and concurrent schedules from raw source |
| Booking/public UI | App shells, wizard, gallery, translations, consent | Behavioral, accessibility and privacy findings | Trace event/state transitions and compare rendered controls to handlers |
| Admin integrity | CMS, mail, services, bookings, profile, media | Lost-update and stale-response findings | Construct late-response / scope-switch schedules for each mutation |
| Operations/verification | CI, runbooks, claimed tests, release config | Launch gates, test blind spots and deployment defects | Match each claim to checked-in tests/config and existing CI evidence |
| Assembly | All findings and coverage ledger | Comprehensive GitHub comment, inline where possible | Attempt to disprove each candidate; repin head; read back posted review |

## Progress

- [x] Resolve repository and capture PR metadata.
- [x] Retrieve initial discussion (one Cloudflare deployment bot comment; no human findings in returned timeline).
- [x] Retrieve 59-file manifest.
- [x] Read required docs and relevant architectural-index sections; review complete map diff in bounded reads.
- [x] Verify local HEAD equals pinned PR and inspect all eight commit messages.
- [x] Read every changed line, including deletions, docs, tests and CI.
- [x] Trace changed runtime paths through unchanged dependencies and latest migrations.
- [x] Inspect existing CI evidence without rerunning anything.
- [x] Validate and challenge each finding; separate static defects, prior audit claims and live gates.
- [x] Recheck live head/discussion; publish detailed findings and inline comments.
- [x] Read back GitHub result and finish ledger.

## Initial observations (not yet findings)

- PR description says production has not changed; Cloudflare bot reports a successful build associated with head. A build notification alone does not prove traffic promotion; inspect deployment configuration before drawing conclusions.
- PR itself lists required DB migrations, Edge deploys, matching `CUSTOMER_GATEWAY_SECRET`, Worker `SUPABASE_ANON_KEY`, and Worker/frontend release gates.
- Prior memory supplied navigation hints only: permanent email-scoped tokens, phone never authorizes access, server-owned booking truth, honest distinction between provider acceptance and delivery. Verify current source rather than assume historical state.

## Resume pointer

Review complete at pinned head. GitHub review submitted and read back; see completion record below. No product changes authorized or made.

## Scope and evidence checkpoint 1

- Local HEAD and remote-tracking head both match GitHub pinned head; local `origin/main` matches pinned base. `git diff --numstat` agrees with the 59-file GitHub manifest. All eight commit messages read (customer fix, admin fix, dead-code removal, audit docs, whitespace docs, smoke watchdog, image drag, final CI docs).
- GitHub CI run `34493156512`: completed/success. Jobs/logs not yet inspected. Inline review thread inventory empty.
- Required README, BACKEND, launch plan, current customer-access release plan, historical public-booking rollout and backup/restore runbook read. Architectural index opening and subsystem ownership sections consulted; large initial output truncated, so remaining map changes require bounded rereads.
- Read all changed runtime lines in Worker/gateway/HMAC, Edge public actions and sender, two migrations, browser adapters/schemas/dialog/App/BookingFlow/About, Desktop/Mobile shells, gallery, translations, consent/dead mock removal, all six changed admin views.
- Read all changed lines in pgTAP, integration, unit contracts, CI, integration config and secret verification. Remaining executable diff: `tools/e2e/smoke.mjs`.
- Read full grouped launch issues and PM audit log. Remaining new audit docs: hygiene/UI/admin/platform. Remaining docs diffs: map, README/BACKEND/historical notices and Edge READMEs.

## Candidate register (not final findings)

1. **Desktop reveal stops before catalog is ready.** `DesktopSite` settles when `[data-booking-step=barber]` geometry is stable for two frames (or deadline), but marker already exists during `rosterLoading`. A delayed catalog arriving after disconnect may grow controls below viewport. Need inspect exact styles and existing smoke to establish supported trigger.
2. **About-scale autosave can still commit out of order.** `SiteView` generation guards response application but `scaleSelect(...onAboutScale...)` is not disabled and every change immediately writes. Older request completing after newer can persist old value while current UI ignores it. Need inspect scaleSelect + adapter SQL contract and distinguish pre-existing gap from new claim.
3. **A→B→A stale mutation results discarded without current-scope reconciliation.** Services/Profile/Bookings guards ignore old-generation completion even if current target has returned to A and its fresh GET happened before old write committed. Potential durable UI/server mismatch; check exact affected handlers and existing test claims.
4. **Development/preview transport missing.** Client now exclusively calls `/api/customer-bookings`; Vite config has no Worker/plugin/proxy, documented `npm run dev`/preview only run Vite. Existing integration injects Worker handler manually. Consider lower-priority integration regression, not production hosting failure.
5. **Customer context lifecycle.** Profile restore + form merge protects nonempty fields, but auto-populated prior-customer fields may survive profile clear/switch; dialog async requests have no cleanup guard. Need construct reachable event sequence before reporting.
6. **Production gates explicitly outstanding.** PR documents missing backup DB URL, Worker key/shared gateway secret, undeployed migrations/Edge/frontend, retained legacy calendar function, no current live provider smoke. Need current read-only metadata, distinguish code defects from operational evidence gaps.

## Rejected/cleared suspicions so far

- `review` direct token simplification remains authorized: current `customer_booking_access_scope` explicitly accepts permanent hashes or unexpired session hashes; phone check alone does not authorize.
- Token mint/rotation lock order appears correct statically: SHARE on token conflicts with rotation upsert, legacy challenge deletion precedes session deletion. Need preserve limits of static review; checked-in new pgTAP tests are sequential, not concurrency proofs.
- Cancellation mail does not call token ensure/repair; only confirmation/reminder build permanent link. Last-booking cancellation therefore does not fail merely because ensure requires confirmed booking.
- Cloudflare bot build message alone cannot prove production promotion. PM audit claims current production version remains prior release; verify via GET if accessible.


## Coverage checkpoint 2

All 59 files' complete PR diff now read. New audit records read fully; historical reports reviewed at changed hunks. Deleted source/tests inspected. Current migration bodies and prior session/token/scope/review contracts read. No binary changes.

- [x] `.github/workflows/ci.yml` — all added/deleted lines read.
- [x] `BACKEND.md` — all added/deleted lines read.
- [x] `CODEBASE-MAP.md` — all added/deleted lines read.
- [x] `LAUNCH_READINESS_PLAN.md` — all added/deleted lines read.
- [x] `PERFORMANCE_AUDIT.md` — all added/deleted lines read.
- [x] `README.md` — all added/deleted lines read.
- [x] `docs/operations/CUSTOMER_ACCESS_REPAIR_2026-09-10.md` — all added/deleted lines read.
- [x] `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md` — all added/deleted lines read.
- [x] `docs/qa/2026-08-27-production-real-life-test.md` — all added/deleted lines read.
- [x] `docs/qa/2026-09-10-audit/luna-hygiene.md` — all added/deleted lines read.
- [x] `docs/qa/2026-09-10-audit/luna-ui.md` — all added/deleted lines read.
- [x] `docs/qa/2026-09-10-audit/pm.md` — all added/deleted lines read.
- [x] `docs/qa/2026-09-10-audit/sol-admin.md` — all added/deleted lines read.
- [x] `docs/qa/2026-09-10-audit/sol-platform.md` — all added/deleted lines read.
- [x] `docs/qa/2026-09-10-launch-issues.md` — all added/deleted lines read.
- [x] `src/about/AboutSection.tsx` — all added/deleted lines read.
- [x] `src/about/GalleryMarquee.tsx` — all added/deleted lines read.
- [x] `src/admin/views/AboutView.tsx` — all added/deleted lines read.
- [x] `src/admin/views/BookingsView.tsx` — all added/deleted lines read.
- [x] `src/admin/views/MailView.tsx` — all added/deleted lines read.
- [x] `src/admin/views/ProfileView.tsx` — all added/deleted lines read.
- [x] `src/admin/views/ServicesView.tsx` — all added/deleted lines read.
- [x] `src/admin/views/SiteView.tsx` — all added/deleted lines read.
- [x] `src/app/App.tsx` — all added/deleted lines read.
- [x] `src/app/DesktopSite.tsx` — all added/deleted lines read.
- [x] `src/app/MobileSite.tsx` — all added/deleted lines read.
- [x] `src/backend/publicBookingActions.ts` — all added/deleted lines read.
- [x] `src/backend/rpcSchemas.ts` — all added/deleted lines read.
- [x] `src/booking/BookingFlow.tsx` — all added/deleted lines read.
- [x] `src/booking/slots.ts` — all added/deleted lines read.
- [x] `src/i18n/en.ts` — all added/deleted lines read.
- [x] `src/i18n/index.ts` — all added/deleted lines read.
- [x] `src/i18n/sv.ts` — all added/deleted lines read.
- [x] `src/mybookings/MyBookingsDialog.tsx` — all added/deleted lines read.
- [x] `src/mybookings/adapters/supabaseMyBookings.ts` — all added/deleted lines read.
- [x] `src/mybookings/customerGateway.ts` — all added/deleted lines read.
- [x] `src/mybookings/domain.ts` — all added/deleted lines read.
- [x] `src/mybookings/port.ts` — all added/deleted lines read.
- [x] `src/site/PrivacyBanner.tsx` — all added/deleted lines read.
- [x] `src/site/storageConsent.ts` — all added/deleted lines read.
- [x] `src/worker.ts` — all added/deleted lines read.
- [x] `supabase/functions/_shared/customerGatewayAuth.ts` — all added/deleted lines read.
- [x] `supabase/functions/public-booking-actions/README.md` — all added/deleted lines read.
- [x] `supabase/functions/public-booking-actions/index.ts` — all added/deleted lines read.
- [x] `supabase/functions/send-confirmation/README.md` — all added/deleted lines read.
- [x] `supabase/functions/send-confirmation/index.ts` — all added/deleted lines read.
- [x] `supabase/migrations/20260910130556_serialize_customer_access_sessions.sql` — all added/deleted lines read.
- [x] `supabase/migrations/20260910133329_guard_customer_token_repair.sql` — all added/deleted lines read.
- [x] `supabase/tests/39_permanent_customer_booking_access_test.sql` — all added/deleted lines read.
- [x] `supabase/tests/45_retire_legacy_customer_lookup_test.sql` — all added/deleted lines read.
- [x] `tests/integration/reviewAccessHelpers.ts` — all added/deleted lines read.
- [x] `tests/integration/reviews.test.ts` — all added/deleted lines read.
- [x] `tests/unit/customerAccessSecurityContract.test.ts` — all added/deleted lines read.
- [x] `tests/unit/publicBookingActionAdapters.test.ts` — all added/deleted lines read.
- [x] `tests/unit/publicBookingActions.test.ts` — all added/deleted lines read.
- [x] `tests/unit/slots.test.ts` — all added/deleted lines read.
- [x] `tools/e2e/smoke.mjs` — all added/deleted lines read.
- [x] `tools/release/verify-edge-secrets.mjs` — all added/deleted lines read.
- [x] `vitest.integration.config.ts` — all added/deleted lines read.

## Current live read-only evidence

- CI head run 34493156512: all three jobs and their steps successful. Logs confirm 501 unit tests in 79 files; 44 integration tests in eight files; 957 pgTAP tests in 56 files. No tests run in this review.
- Supabase migration inventory ends at 20260905154608_customer_http_only_session; neither PR migration exists live.
- Edge inventory: public-booking-actions v8, send-confirmation v47; retired calendar-sync still ACTIVE v21. Inventory does not prove source parity or provider delivery.
- Cloudflare active deployment 9ca2d3f8-9acd-40f6-a5bd-f2bda59d0568, created 2026-09-08T08:14:30.92879Z, version 5f6f21bf-3393-474b-b74d-670cbf7559ae at 100%. Current bindings only ASSETS and SUPABASE_URL. SUPABASE_ANON_KEY and CUSTOMER_GATEWAY_SECRET missing. PR build did not promote traffic.
- Latest three backups fail: 34449508611, 34323766026, 34198548494. Job 102781783693 fails Validate backup configuration with exact error: Missing SUPABASE_DB_URL secret. Repository secret inventory contains only SUPABASE_STORAGE_SECRET_KEY; no values read.
- Resend mail.bladeblendstudio.se: verified, sending enabled, EU region, click/open tracking off. Does not prove Auth journeys, inbox behavior, reminders or Calendar.
- Primary docs checked: MDN ResizeObserver.disconnect, MDN Set-Cookie, Cloudflare request headers. Supabase changelog fetch failed; no implementation undertaken.

## Candidate refinement

- Confirmed source-level lost-write schedule in Services: target effect now clears busyId. Hold A save1 before DB UPDATE; switch B then A, finish reload; save2 on same row can commit. Release save1: unconditional updateService by id overwrites new values; generation check discards response, so UI says save2 while DB holds save1. No DB version check. Stronger than stale display alone.
- Profile similar only with correct timing: first image delayed before decode/current-path read, second upload commits, first then reads second path and passes CAS. Do not claim uploads sharing the same expected path both win: server CAS correctly rejects that case. Homepage logo has separate client expected-path protection.
- About-scale autosave: select stays enabled (disabled defaults false), each change writes unconditional upsert. Generation only ignores stale reply. Existing unresolved CMS defect; separate from changed target-scope reset.
- Cold catalog differs from cold JS chunk. Barber step marker exists during rosterLoading; observer can settle/disconnect before listActive fulfills. Actual buttons are taller than loading placeholder and may wrap into multiple rows. Current smoke checks DOM visibility, not viewport bounds; recorded cold proof delayed chunk only. Report source-derived delayed-catalog scenario, not measured pixels.
- Scope guards protect B UI against A replies but do not serialize A writes across A→B→A or reconcile A reads made before pending A writes commit.


## Disproof checkpoint 3

- Owner target selector is locked only for Schedule (AdminShell:121); Services/Profile/Bookings have no pending-write navigation lock. F1 remains reachable.
- Read existing /tmp evidence without running it. service-aba-race.mjs resolves a deferred A reorder after returning to A and expects the pre-reorder A order, without modeling persistent DB state. profile-newer-upload-race.mjs checks A versus B, not two pending uploads for A.
- cold-lazy-booking-proof.mjs delays BookingFlow.tsx module by 1800ms, not public_booking_catalog. It does not disprove delayed-roster finding.
- initial-contact-late-hydration-proof.mjs mocks successful list without session_proof. Current listCustomerBookingsResponse requires that field; adapter returns system and App ignores it. Its equality-only assertion can therefore pass without hydration ever occurring. This weakens final-head UI evidence; no rerun performed.
- Customer identity-switch finding confirmed as source trace: first profile auto-fills A; another tab authenticates B into shared same-origin cookie; opening My Bookings in original tab resolves B and updates App customerProfile. Desktop BookingFlow remains mounted, and nonempty A auto-fill wins current.form.* || B.*. AboutSection similarly retains A phone; review submits it with B cookie and fails scope check. Neither effect clears old auto-fill when profile becomes undefined. Manually edited fields must remain protected, but auto-filled values need ownership tracking.
- Initial-load race confirmed in two touched admin surfaces: Site font controls render before loaded and remain enabled; late initial listSettings replaces presentationDraft/settings without comparing edit generation. Gallery upload input is enabled while listGallery is pending; successful upload appends, then old list response replaces images. Both are pre-existing omissions in claimed admin-race repair scope.
- Rechecked media CAS; no allegation of bypass. Slow first photo can still win if delayed before the Edge's post-decode current-path read. Exact same-observed-path races are correctly rejected by CAS.
- No anonymous booking authorization bypass established. Existing numeric admin_create_booking revokes PUBLIC but not explicitly anon; internal owner/barber check fails closed. Treat as known ACL hardening, not exploit.
- Remaining known audit items source-checked: CMS hardcoded fallback, admin gate only revalidates at mount, phone-change review restriction, Turnstile success-only/no deadline, ICS line folding omitted. Full dependency advisory count is historical audit evidence only; did not run npm audit.


## Completion record

- Submitted 2026-09-10T16:06:36Z as a COMMENT review, not an approval or merge.
- Review: https://github.com/omar-y-abdi/KNC-STUDIO/pull/58#pullrequestreview-5169486874
- Anchored commit: 5b45a09c44ce32fd64be724e4855d96273583004, rechecked before submission.
- Readback confirms exact overview body, seven matching inline comment bodies, all current and unresolved.
- Inline comment IDs F1-F7: 3981076403, 3981076413, 3981076420, 3981076426, 3981076433, 3981076443, 3981076449.
- Tracked working-tree and index diffs remain empty. Only new local artifact is this ledger; both pre-existing untracked user files remain untouched.
- No application code, tests, builds, browser scenarios, SQL statements, deployments or customer-data operations executed. Read-only metadata/source/history/log inspection only. No subagents.
- Static limitations remain explicit in review: failure schedules are source-derived; prior runtime claims are not presented as newly reproduced; production/provider gates remain open.

## Final review prepared

Final source check: RFC 5545 section 3.1 confirms CRLF content-line termination and recommended folding above 75 octets. Cloudflare Turnstile validation docs show hostname/action checks and bounded request handling. Direct primary-source links added to submitted review text. Core finding descriptions unchanged.

Verdict: request corrections; not launch-ready. Six functional/integration findings (F1-F6) plus verification gap F7. Full review text and inline evidence follow. Submitted as GitHub COMMENT review 5169486874.

**Not approved for launch at `5b45a09c44ce32fd64be724e4855d96273583004`.** This solo review found six functional/integration issues and a material verification gap. F1, F2, F3 and F6 concern behavior introduced or exposed by this change; F4 and F5 are pre-existing omissions in the PR's claimed admin/CMS repair scope. The inline comments contain source links, concrete failure schedules and the required correction.

I read the description, current discussion, all eight commits' messages and the complete 59-file diff, including deletions, migrations, tests, CI and audit documents. I traced the changed paths through their adapters and current DB definitions. No application code, tests, builds or live customer operations were executed. The only local write is the Markdown review ledger. Counterexamples below are static deductions, not newly executed reproductions.

| Finding | Priority | Failure and consequence |
| --- | --- | --- |
| F1 | P1 | [Keep outstanding writes serialized when a barber is revisited](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/views/ServicesView.tsx#L103) |
| F2 | P2 | [Distinguish typed fields from fields auto-filled for a previous customer](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/booking/BookingFlow.tsx#L99) |
| F3 | P2 | [Do not settle the reveal before the barber catalog has arrived](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/app/DesktopSite.tsx#L110) |
| F4 | P2 | [Serialize the About font-size autosave as well as explicit save buttons](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/views/SiteView.tsx#L256) |
| F5 | P2 | [Fence initial reads against edits and uploads made while loading](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/views/AboutView.tsx#L280) |
| F6 | P2 | [Provide the same-origin endpoint in the supported local dev/preview path](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/backend/publicBookingActions.ts#L36) |
| F7 | P1 | [Make the launch-critical browser and concurrency regressions reproducible at this head](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/tests/integration/reviewAccessHelpers.ts#L29) |

**The central correctness problem is that protecting the current UI from an old reply does not protect persisted state from an old write.** For Services, the new target reset allows a second save after A → B → A while the first save still runs. If the second update commits first, the first update can overwrite it; the generation check then hides the evidence. Similar re-entry leaves Bookings stale and can reorder profile-image intent. The fix needs mutation ordering/versioning and reconciliation, not only response suppression.

The customer auto-fill fix has a related ownership gap: untouched auto-filled values are treated as typed input. A verified customer switch updates App's profile but preserves the previous customer's populated fields. The desktop reveal guard also conflates a stable loading placeholder with a ready roster. None of these cases is disproved by a green delayed-response test that does not model the corresponding server state, profile change or delayed catalog.

**Existing verification checked, without rerunning it:** [CI run 34493156512](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/34493156512) passed all three required jobs. I inspected the logs and confirmed 501 unit tests, 44 integration tests and 957 pgTAP assertions. The customer integration is a useful real handler → Edge → DB check. It does not turn the Vite-hosted browser smoke into an authenticated end-to-end test, and the manual cookie jar does not establish browser cookie behavior. The /tmp-only evidence and stale hydration fixture described in F7 need correction before those stronger claims can serve as a repeatable launch gate.

**Production launch gates remain open. These are not evidence that the PR was secretly deployed.** Read-only platform checks during this review found:

| Gate | Current evidence | Required outcome before launch |
| --- | --- | --- |
| Coordinated customer-access release | Supabase migration inventory ends at `20260905154608`; neither PR migration is applied. Edge inventory is `public-booking-actions` v8 and `send-confirmation` v47. Cloudflare still serves deployment `9ca2d3f8-9acd-40f6-a5bd-f2bda59d0568`, version `5f6f21bf-3393-474b-b74d-670cbf7559ae`, from September 8 at 100%. | Complete the reviewed migration → Edge → Worker/frontend release and record deployed versions plus live acceptance evidence. The bot's successful PR build is not a traffic promotion. |
| Worker bindings | Current Worker settings list only `ASSETS` and `SUPABASE_URL`. `SUPABASE_ANON_KEY` and `CUSTOMER_GATEWAY_SECRET` are absent. | Install the matching project key and matching high-entropy Worker/Edge gateway secret, then verify the actual public route. Otherwise the new customer proxy fails closed and dynamic discovery still falls back. |
| Recoverability | Latest backup [run 34449508611](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/34449508611), job `102781783693`, fails configuration validation with `Missing SUPABASE_DB_URL secret`; the preceding two runs also failed. | Obtain a successful encrypted DB+Storage backup and a verified restore under [the restore runbook](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/docs/operations/BACKUP_RESTORE.md#L1). The currently failing workflow provides no recovery artifact. |
| Retired Calendar surface | `calendar-sync` remains ACTIVE v21 in the live function inventory. | Check last use/dependencies, retire it under the operational plan and verify the durable replacement; inventory alone does not prove an active caller or an authorization bypass. |
| Provider acceptance | Resend `mail.bladeblendstudio.se` is verified with sending enabled and tracking disabled. This review did not send mail or exercise Auth/Calendar/media/restore workflows. | Supply the current release's controlled Auth invitation/recovery/email-change, customer booking/cancel/review/reminder, Calendar and image-lifecycle acceptance evidence called for by the runbooks. Domain verification or delivery acceptance alone is insufficient. |

**The PR also explicitly leaves product/security weaknesses unresolved.** They must not disappear behind the phrase “fully launch ready.” These are existing issues, distinct from the new regressions above:

- **Narrow-mobile booking controls remain obstructed by the privacy banner.** [The submitted UI audit](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/docs/qa/2026-09-10-audit/luna-ui.md#L51) records 320–390px cases. Current [fixed banner layout](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/site/PrivacyBanner.tsx#L85) still overlays the page without reserving space; this PR changes only the no-op storage call. I did not repeat the geometry measurement. Choose and verify a layout that leaves booking/history controls reachable.
- **CMS failure can publish stale business facts.** [The browser snapshot](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/site/useSiteChrome.ts#L79) returns hardcoded DEFAULT_CHROME when no current cache exists; [Worker discovery failure](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/worker.ts#L301) renders DEFAULT_BUSINESS. I verified those branches statically. After a contact/address/policy change, a slow or failed read can display old details. Decide on last-verified data or an honest unavailable state and verify it.
- **The review rule strands customers after a phone change.** [Token ensure](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/supabase/migrations/20260824075454_permanent_customer_booking_access.sql#L65) updates the phone associated with the email; [Review authorization](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/supabase/migrations/20260823174500_close_launch_review_findings.sql#L537) requires both that scoped phone and a completed booking with it. With an old completed visit and a new-number future visit, the old number fails scope and the new number has no completed visit. The [documented product decision](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/docs/qa/2026-09-10-launch-issues.md#L96) is still open.
- **Disabled staff can retain already-loaded customer data in an open tab.** [The admin gate](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/AdminApp.tsx#L40) checks the profile on mount, with no Auth/profile/focus/visibility revalidation in that component. DB denial of future calls is a separate protection and does not clear loaded UI. Define the required lock/clear behavior; I am not claiming a fresh DB-read authorization bypass.
- **Turnstile validation and ACL cleanup remain hardening gaps.** [The shared verifier](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/supabase/functions/_shared/turnstile.ts#L9) and [the public-actions verifier](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/supabase/functions/public-booking-actions/index.ts#L202) check success without hostname/action binding or a fetch deadline. The numeric [admin_create_booking migration](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/supabase/migrations/20260831220511_decimal_service_prices_and_duration_contract.sql#L164) revokes PUBLIC but not explicitly anon; its internal authorization check still rejects anonymous booking. The audit's live ACL observation needs a targeted ACL correction/readback, not an unsupported claim of exploitation.
- **Calendar export still omits line folding and the final CRLF.** [buildIcs](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/booking/ics.ts#L62) explicitly omits folding and joins lines without a final terminator. Long or multibyte CMS/service text needs a standards-compliant export regression; no particular Calendar client failure was reproduced here.
- **Tooling risks remain recorded, not remeasured.** The PR audit reports 12 development-tool advisories and a local Wrangler compatibility issue. I did not execute a fresh dependency audit or Wrangler. Runtime-only CI audit passed; that does not evaluate the development dependency graph. Tracked public `.env`, overlapping policies and large files are maintenance items, not established secret leaks or performance failures.
- **The architectural index still misidentifies current definitions.** [The RPC table](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/CODEBASE-MAP.md#L509) lists repair's migration and then uses “same” for rotation, list and cancellation. Rotation/list are replaced by `20260910130556`; cancellation's current definition remains in `20260824075454`. The table also omits session establishment. Correct these source-of-truth pointers so future release work does not inspect the wrong function bodies.

The permanent-token hash fix, domain-separated session proof, token-row lock ordering and generation-conditional ciphertext repair withstand the static counterexamples I checked. I found no supported reason to weaken those boundaries. Keep them while addressing the remaining state/transport defects.

**Acceptance boundary:** fix the functional findings, correct and preserve the critical regressions at the reviewed head, then complete the separately authorized operational/product launch gates. This review requests no deployment, data mutation, merge or unsolicited refactor. Until that evidence exists, neither a launch approval nor a `👍🏾` is justified.

## Inline finding detail

### F1 P1: Keep outstanding writes serialized when a barber is revisited

Anchor: src/admin/views/ServicesView.tsx:99-103 at 5b45a09c44ce32fd64be724e4855d96273583004.

The new target-change reset clears `busyId` even though the old request is still executing. The owner selector stays enabled outside Schedule ([src/admin/AdminShell.tsx](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/AdminShell.tsx#L121)). A source-level counterexample is: send price save S1 for barber A, delay it before its DB UPDATE, switch A → B → A, let the new A read finish, then save price S2. S2 can commit successfully before S1; when S1 resumes, [updateService](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/adapters/servicesAdmin.ts#L98) unconditionally overwrites the row by id. The generation check at line 151 only discards S1's response, leaving the UI showing S2 while bookings use S1's price/duration/availability.

Retain pending mutation identity across target changes and serialize writes for the same resource, or enforce a server version condition. Reconcile successful old-generation mutations when the current target is A. Merely dropping their replies is insufficient. [ProfileView](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/views/ProfileView.tsx#L61) has the same reset pattern; its server CAS does not protect intent order if the first upload is delayed before the post-decode current-path read. Bookings can also remain stale after returning to A before an older cancellation completes.

This is a static interleaving, not a runtime reproduction performed during this review.

### F2 P2: Distinguish typed fields from fields auto-filled for a previous customer

Anchor: src/booking/BookingFlow.tsx:95-99 at 5b45a09c44ce32fd64be724e4855d96273583004.

The new `current.form.* || contact.*` rule treats every nonempty value as customer-entered. Values auto-filled for customer A therefore survive a verified switch to B. Reachable sequence: keep the desktop booking form mounted with A's auto-fill, authenticate B's email link in another tab (replacing the shared site cookie), then reopen My Bookings in the first tab. [loadBookings](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/mybookings/MyBookingsDialog.tsx#L112) updates App's profile to B, but the mounted form retains A's name, phone and email. A subsequent booking can be submitted using A's contact details. The previous effect replaced contact data when the profile changed.

The new [AboutSection auto-fill](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/about/AboutSection.tsx#L160) has the same issue: untouched A phone remains while review requests use B's cookie, so the gateway rejects the scope. Both effects also leave old auto-fill when the verified profile is cleared. Track dirty fields separately from auto-fill ownership; replace/clear untouched old auto-fill on identity changes while preserving actual typed edits. Static state trace; no browser run in this review.

### F3 P2: Do not settle the reveal before the barber catalog has arrived

Anchor: src/app/DesktopSite.tsx:106-110 at 5b45a09c44ce32fd64be724e4855d96273583004.

The barber-step element already exists while `rosterLoading` is true ([src/booking/BookingFlow.tsx](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/booking/BookingFlow.tsx#L539)). Two stable frames, or the 1200ms deadline, can therefore disconnect the only resize observer while `listActive()` is still pending. When the roster arrives later, the placeholder becomes taller buttons and may wrap into multiple rows; if that pushes controls below a short viewport, no reveal runs again. The effect depends only on `booking` and `scrollRootRef`, not catalog readiness.

The prior cold-load proof in the audit delays the BookingFlow JS chunk, not the catalog RPC; those are different cases. Gate final settling on the actual roster-ready state, then settle geometry while preserving the existing protection against later unwanted scroll jumps. Add a delayed-catalog/short-viewport regression that checks control bounds. This finding is derived from the callback lifecycle; no new pixel measurements were taken. [ResizeObserver.disconnect removes observed targets](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver/disconnect).

### F4 P2: Serialize the About font-size autosave as well as explicit save buttons

Anchor: src/admin/views/SiteView.tsx:253-256 at 5b45a09c44ce32fd64be724e4855d96273583004.

This generation guard protects response application, but an existing write race remains in the CMS path being repaired. [The About size selector](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/views/SiteView.tsx#L914) omits the disabled argument, so it remains enabled; each change calls `onAboutScale` → `saveSetting`. Choose `sm`, hold that write, then choose `xl`. If the `xl` upsert commits first and `sm` commits last, [the unconditional settings upsert](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/adapters/siteAdmin.ts#L68) leaves `sm` published. The stale-response guard ignores that result and the UI remains `xl`.

This is a pre-existing gap in the claimed CMS race repair, not a newly introduced endpoint. Disable/serialize this autosave while pending, or coalesce changes with guaranteed write ordering; ensure the final selected value is the final persisted value. Test reversed server completion order, not only whether a stale response rewrites the input.

### F5 P2: Fence initial reads against edits and uploads made while loading

Anchor: src/admin/views/AboutView.tsx:278-280 at 5b45a09c44ce32fd64be724e4855d96273583004.

The alt-generation fix does not protect the gallery list. The upload input is enabled before `listGallery` finishes (`disabled={busy}`, line 343). A read can capture the old list, an upload can then succeed and append its new row here, and the delayed initial read can finally call `setImages(result.value)` at line 253 and remove the successfully uploaded row from the UI. The success notice remains, but the owner cannot manage that upload until another load.

The same initial-hydration gap remains in SiteView: [the font controls](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/views/SiteView.tsx#L899) are rendered before `loaded`, while [the initial settings response](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/admin/views/SiteView.tsx#L155) unconditionally replaces `presentationDraft`/settings, losing a newly selected draft. These are pre-existing omissions in the admin-race scope. Gate mutations/controls until their authoritative initial state loads, or make hydration generation-aware and merge/revalidate successful mutations. Static request-order counterexamples; no tests run here.

### F6 P2: Provide the same-origin endpoint in the supported local dev/preview path

Anchor: src/backend/publicBookingActions.ts:33-36 at 5b45a09c44ce32fd64be724e4855d96273583004.

All customer actions now require `/api/customer-bookings`, but [Vite config](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/vite.config.ts#L1) contains only the Preact plugin/build settings and has no Worker integration or proxy. [The documented dev/preview scripts](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/package.json#L8) run Vite alone. With the backend configured, My Bookings, fresh-link requests, cancellation and reviews therefore hit an endpoint that those servers do not implement and surface a system error. The integration shim manually intercepts this URL, masking this seam; the browser CI also serves Vite preview and only opens/closes the dialog.

Keep the first-party production boundary, but provide a working development transport with appropriate local cookies/Origin handling, or update the supported workflow to run the Worker and validate it through the browser. Do not silently fall back to third-party production cookies. This is a source/config integration regression; no local server was started in this review.

### F7 P1: Make the launch-critical browser and concurrency regressions reproducible at this head

Anchor: tests/integration/reviewAccessHelpers.ts:27-29 at 5b45a09c44ce32fd64be724e4855d96273583004.

This bridge does exercise the real customerGateway handler, Edge and DB, but it unconditionally accepts Set-Cookie into a Node variable. It cannot verify browser Secure/host/SameSite behavior, first-party replacement, Worker routing, or UI identity restoration. [The checked-in customer browser smoke](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/tools/e2e/smoke.mjs#L399) only opens and closes the dialog. The new pgTAP cases are sequential and do not exercise the mint-versus-rotation interleavings.

The PR records the stronger browser/admin/concurrency harnesses only under /tmp. I read the existing `initial-contact-late-hydration-proof.mjs` without running it: its mocked successful list omits `session_proof`, which [the final response schema](https://github.com/omar-y-abdi/KNC-STUDIO/blob/5b45a09c44ce32fd64be724e4855d96273583004/src/backend/rpcSchemas.ts#L109) now requires. The adapter consequently reports system, App ignores the result, and its equality-only assertion can pass without hydration occurring. The recorded A→B→A test similarly checks that a deferred result is ignored, not the final persisted state.

Preserve the critical regressions in existing repository test files/CI (consistent with the earlier restriction on new standalone test files), correct stale fixtures, and assert the intended hydration/mutation actually occurred. Existing green totals do not establish these release claims. This is a verification gap; I did not rerun any tests.
