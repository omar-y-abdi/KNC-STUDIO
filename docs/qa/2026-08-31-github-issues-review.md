# GitHub issue review — feedback required before PR work

Repository: [omar-y-abdi/KNC-STUDIO](https://github.com/omar-y-abdi/KNC-STUDIO)

## Read this first

Every issue below was written by an agent with access to the GitHub repository and Supabase. The issue text is therefore an agent finding and recommendation, not a decision from you.

No agent should start a PR fix from these issues alone. Before implementation, you should decide whether to:

- approve the suggested fix;
- approve it with changed scope;
- reject or close the issue; or
- require more evidence first.

The questions under **Specific feedback needed before any PR** are the minimum decisions needed from you. Write your answer directly into this file. Even when you approve a fix, the agent must verify the current code, migration state, and live state before changing anything.

P0/P1/P2 below are my working priority recommendations, not GitHub labels:

- **P0** — launch, legal, security, or production-control blocker.
- **P1** — important correctness, privacy, accessibility, or maintenance fix.
- **P2** — low-risk cleanup, documentation, or SEO maintenance.

## Review scope and duplicate cleanup

- 31 GitHub issue records existed before cleanup. All were open, with no labels or comments.
- #28 was deleted because #35 explicitly superseded it.
- 30 GitHub issues remain.
- #51 is an open pull request, not an issue. It is referenced under #49 but is not included as an issue.
- No other exact duplicate was found.

Related items that are intentionally separate:

- #23 repeats QA-001 in the repository QA report, not another GitHub issue.
- #48 and #49 remove different sets of database functions.
- #38 addresses recovery-request abuse; #53 addresses Auth settings and one-time-token lifetime.
- #25 addresses token exposure in the first URL request; #42 addresses plaintext token storage in the durable outbox.
- #49 plus PR #51 is a normal issue-and-implementation-PR pair.

### Deleted duplicate: [#28 — Remove duplicate storage-consent policy implementation from deviceMemory](https://github.com/omar-y-abdi/KNC-STUDIO/issues/28)

#35 says the entire phone-memory feature is unused and supersedes the narrower deduplication task in #28. #28 was deleted. GitHub issue deletion is permanent.

## Issue-by-issue feedback sheet

### [#22 — Clean production public catalog and stale My Bookings copy](https://github.com/omar-y-abdi/KNC-STUDIO/issues/22) — P0

**What the issue is**

The agent claims production currently shows placeholder-looking barber and service data, such as `k` and `fqqq`. It also claims customer confirmation text still says that a phone number can retrieve bookings, while the live product now uses secure email links.

**Why it is wrong**

Customers could see false names, prices, or services. They could also follow instructions for a booking-access method that no longer exists. The database is the source of truth, so a green frontend build would not correct bad production data.

**What the suggested fix will do**

It will ask the owner to approve the real barbers, services, prices, durations, and schedules; update those values through existing admin/database controls; update Swedish and English confirmation copy; and verify the public catalog and booking UI afterward. It will not restore seed data automatically.

**Specific feedback needed before any PR**

- Are `k` and `fqqq` test data? Should they be removed, deactivated, or kept?
- What exact barbers, services, prices, durations, and schedules should be active?
- Approve replacing phone-lookup wording with secure-link wording in both languages?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Replace phone-lookup wording to be mail specific. The email will be used to send the secure link, the phone-number will only be used so that the barber can call the booking client's phone. All barbers are currently inactive by me because this is currnently a test/staging environment, and the services are not yet finalized. The list of active barbers and services will be provided by me after everything is ready.]`

### [#23 — Production backup workflow cannot start without SUPABASE_DB_URL](https://github.com/omar-y-abdi/KNC-STUDIO/issues/23) — P0

**What the issue is**

The agent claims the encrypted GitHub backup workflow stops before creating a backup because the repository secret `SUPABASE_DB_URL` is missing.

**Why it is wrong**

The site then has no verified recovery artifact from this automation. A workflow that only reports a missing secret is not providing backup protection.

**What the suggested fix will do**

It will add the production database connection URI as a GitHub Actions secret, manually run the backup, and verify the encrypted archive, checksums, and restore structure. It should not weaken the fail-closed check.

**Specific feedback needed before any PR**

- Do you authorize adding the production database URI to GitHub Actions secrets?
- Who will supply or retrieve the database password without rotating production credentials?
- Approve a manual backup run and restore-tree verification after the secret is added?
- **Your decision:** `[x] Approve  [ ] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[The secrets will be added by me when the website is fully ready for production. The database password will be retrieved by me and will not be rotated.]`

### [#24 — Use Europe/Stockholm consistently for booking boundaries and calendar exports](https://github.com/omar-y-abdi/KNC-STUDIO/issues/24) — P1

**What the issue is**

The agent claims the booking calendar uses the visitor's device date while the backend uses Europe/Stockholm. It also claims downloaded ICS files contain floating local times, which can import at the wrong instant on another device.

**Why it is wrong**

A customer near a date boundary could see the wrong booking day. A calendar event could appear at a different time even though the database booking is correct.

**What the suggested fix will do**

It will base date selection on Stockholm time, convert the chosen booking wall-clock time back to a Stockholm instant, and serialize ICS `DTSTART`/`DTEND` as UTC. It will add date-boundary and ICS regression tests while keeping the existing Google Calendar timezone behavior.

**Specific feedback needed before any PR**

- Confirm Europe/Stockholm is always the authoritative booking timezone, including customer calendar exports.
- Should customers see salon time or their own local time in confirmation/calendar UI?
- Approve changing ICS output from floating local time to UTC?
- **Your decision:** `[x] Approve  [ ] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[stockholm time is the authoritative timezone for all bookings, and ICS output will be changed to UTC.]`

### [#25 — Stop putting permanent My Bookings bearer tokens in Worker request paths](https://github.com/omar-y-abdi/KNC-STUDIO/issues/25) — P0

**What the issue is**

The agent claims permanent customer-access tokens are first sent as URL path segments. Cloudflare Worker request logs may therefore capture the token before the Worker redirects it into a browser fragment.

**Why it is wrong**

The token grants access to list and cancel operations. A redirect cannot remove a token already present in the first HTTP request or its telemetry.

**What the suggested fix will do**

It will generate fragment-only links, rotate or migrate the existing production token, and later remove the legacy path-token redirect after old links are handled. It will keep the existing fragment parser.

**Specific feedback needed before any PR**

- Existing project guidance deliberately chose permanent random root-path links. Do you want to change that decision to fragment-only links?
- If yes, approve rotating/migrating the existing production token and define how old emailed links should behave.
- If no, reject this issue or request a different mitigation that preserves root-path links.
- **Your decision:** `[ ] Approve fragment-only change  [x] Preserve root-path design  [ ] Need more evidence`
- **Your notes:** `[This is a deliberate design decision to use permanent random root-path links for My Bookings access. We will preserve this design and not change it to fragment-only links.]`

### [#26 — Drop superseded taken_slots SECURITY DEFINER RPC](https://github.com/omar-y-abdi/KNC-STUDIO/issues/26) — P1

**What the issue is**

The agent claims the old `public.taken_slots(text,timestamptz,timestamptz)` function is unused but still exists and can be executed by authenticated users.

**Why it is wrong**

Unused privileged database code increases attack surface and makes security reviews and migrations harder. It can also mislead future developers about which availability function is authoritative.

**What the suggested fix will do**

It will add a forward migration that drops only the exact function signature and a pgTAP assertion proving it stays absent. Current availability functions should remain unchanged.

**Specific feedback needed before any PR**

- Confirm no external integration or old admin tool still calls `taken_slots`.
- Approve permanent removal after dependency and live-caller checks?
- **Your decision:** `[x] Approve  [ ] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Still don't understand what this function does, but I approve its removal as it is unused and increases attack surface.]`

### [#27 — Leaked-password protection unavailable on current Free plan](https://github.com/omar-y-abdi/KNC-STUDIO/issues/27) — P0

**What the issue is**

Supabase's leaked-password protection is disabled. The agent says the current Free plan cannot enable it, even though local password rules check length and character types.

**Why it is wrong**

A complex password can still be a password already exposed in a breach. This is a staff-account risk and a platform-plan limitation, not a missing frontend validator.

**What the suggested fix will do**

It will either move Supabase to a supported paid plan and enable native protection, or record explicit owner/client acceptance of the remaining risk. It will not add a custom breach-password service.

**Specific feedback needed before any PR**

- Is a Supabase plan upgrade approved and budgeted?
- If not, do you explicitly accept this risk for handoff, and where should that acceptance be recorded?
- **Your decision:** `[ ] Upgrade and enable  [x] Accept Free-plan risk  [ ] Need more evidence`
- **Your notes:** `[No PR for this fix, every password still gets saved in apple/google password managers and they have their own breach detection. We will accept the Free-plan risk for now.]`

### [#29 — Remove deleted files from Vitest coverage include list](https://github.com/omar-y-abdi/KNC-STUDIO/issues/29) — P2

**What the issue is**

The coverage configuration still names four source files that no longer exist.

**Why it is wrong**

Coverage configuration stops being a reliable description of what is measured. It preserves names from an older code structure and can confuse future maintenance.

**What the suggested fix will do**

It will remove the four stale paths and leave the rest of the coverage setup unchanged.

**Specific feedback needed before any PR**

- Approve deleting only the four stale entries?
- Do you want replacement coverage requirements added, or only this cleanup?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[everything should be source pathed, not hardcoded path names.]`

### [#30 — Reject malformed service numbers instead of silently truncating](https://github.com/omar-y-abdi/KNC-STUDIO/issues/30) — P1

**What the issue is**

The admin service editor uses `parseInt()`. Values such as `199.99` or `199abc` can therefore be stored as `199` instead of being rejected.

**Why it is wrong**

An owner can enter one price or duration and unknowingly save another. That is silent data corruption.

**What the suggested fix will do**

It will validate the entire trimmed input as an integer before converting it and add tests for decimals, trailing text, and invalid values. Existing range checks stay in place.

**Specific feedback needed before any PR**

- Confirm prices and durations must be whole integers. Are decimal prices ever valid?
- Should signs, separators, or other number formats be accepted?
- Approve rejecting every partial-number string rather than coercing it?
- **Your decision:** `[x] Approve  [ ] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Prices can be decimals but durations must be whole int, if the duration contains decimal they will be rounded up to the nearest whole int]`

### [#31 — Make service ordering atomic and preserve unique contiguous order](https://github.com/omar-y-abdi/KNC-STUDIO/issues/31) — P1

**What the issue is**

The agent claims moving a service uses two independent database writes, so a partial failure can leave a half-swap. It also claims deleting and then adding a service can create duplicate order numbers.

**Why it is wrong**

The menu can end up in an order the UI never represented. Later edits can then behave unpredictably, especially when two admins work at once.

**What the suggested fix will do**

It will move reorder and compaction into one authorized database transaction, add a database integrity rule, and test concurrent/partial-failure cases. It may change database schema and admin RPC behavior.

**Specific feedback needed before any PR**

- Confirm ordering is per barber or global across all services.
- Confirm the desired model: zero-based/one-based, contiguous after delete, and no duplicate positions.
- Approve a new authorized RPC and database constraint if the current model cannot be preserved safely?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Ensure NO regressions are introduced, and the ordering is per barber. The desired model is zero-based, contiguous after delete, and no duplicate positions. The new authorized RPC and database constraint will be implemented to ensure this behavior.]`

### [#32 — Move btree_gist out of the exposed public schema](https://github.com/omar-y-abdi/KNC-STUDIO/issues/32) — P1

**What the issue is**

The required `btree_gist` PostgreSQL extension is installed in the API-exposed `public` schema. Supabase's security advisor warns about that placement.

**Why it is wrong**

The application needs the extension's operator classes for overlap constraints, but does not need its extension objects exposed as part of the public API schema.

**What the suggested fix will do**

It will relocate the existing extension to a private extension schema, then verify booking and recurring-break overlap constraints still work. It should not remove the extension or casually rebuild constraints.

**Specific feedback needed before any PR**

- Approve a production schema/extension relocation migration?
- Is there a preferred non-public schema, such as `extensions`?
- Require a backup and linked-production verification before applying it?
- **Your decision:** `[ ] Approve  [ ] Approve with changes  [ ] Reject/close  [x] Need more evidence`
- **Your notes:** `[If proven non-safe, fix this issue. If safe, leave it as is. Need more evidence on whether this relocation is safe and will not break any existing functionality.]`

### [#33 — Complete the privacy notice for customer personal data](https://github.com/omar-y-abdi/KNC-STUDIO/issues/33) — P0

**What the issue is**

The agent claims the privacy page explains collected data but does not state all required controller details, legal bases, retention rules, customer rights, or complaint information.

**Why it is wrong**

Customers are asked for identifiable data without receiving complete information about who controls it, why it is processed, how long it is kept, and what rights they have. The missing legal facts cannot be invented by an agent.

**What the suggested fix will do**

It will collect the correct facts from the controller, update the existing static page in Swedish and English, and align processor/recipient descriptions with real arrangements.

**Specific feedback needed before any PR**

- Provide the legal controller name, address, email, and any required registration details.
- Decide and provide legal basis per processing purpose.
- Decide ordinary booking/customer retention periods or criteria.
- Confirm which rights and supervisory authority wording should be used.
- Identify who reviews and approves the final legal text.
- **Your decision:** `[x] Provide facts and approve drafting  [ ] Reject/close  [x] Need legal advice/evidence`
- **Your notes:** `[The privacy policy does not state with whom it shares, transfer, or disclose Google user data, the privacy policy needs to be updated to include ALL required controller details, legal bases, retention rules, customer rights, and complaint information.]`

### [#34 — Delete unsupported ACP discovery manifest](https://github.com/omar-y-abdi/KNC-STUDIO/issues/34) — P1

**What the issue is**

The agent claims `/.well-known/acp.json` advertises an ACP appointment-booking service that does not match the upstream proposal and is not implemented by the site.

**Why it is wrong**

Machines may treat the site as supporting a protocol and service it cannot actually provide. That creates false interoperability claims.

**What the suggested fix will do**

It will delete the manifest and remove ACP references from `llms.txt` and smoke tests. It will not add a custom protocol. A future conforming implementation could restore discovery later.

**Specific feedback needed before any PR**

- Do you intend to support ACP in the product soon?
- If not, approve deleting the manifest and all ACP claims?
- If yes, provide the supported service/version and implementation scope instead of deleting it blindly.
- **Your decision:** `[ ] Delete ACP claims  [x] Keep and plan real ACP implementation  [ ] Need more evidence`
- **Your notes:** `[Fix so that it is properly implemented.]`

### [#35 — Delete obsolete phone-memory consent feature](https://github.com/omar-y-abdi/KNC-STUDIO/issues/35) — P1

**What the issue is**

The agent claims the site asks users for permission to remember a phone number even though the current My Bookings flow uses secure email links and has no live caller for the phone-memory feature.

**Why it is wrong**

The site adds a consent choice, cookie, privacy-policy text, code, and tests for functionality customers do not receive. It creates friction and a misleading privacy surface.

**What the suggested fix will do**

It will remove the unused phone-memory module, optional-cookie logic, related banner/preferences UI, translations, privacy copy, and tests. Secure-link session storage required after valid access will remain.

**Specific feedback needed before any PR**

- Confirm phone-memory is permanently abandoned and should not return.
- Confirm no customer or staff workflow still expects remembered phone lookup.
- Approve deleting the optional consent category and related public copy?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[The phone-memory feature is permanently abandoned and is replaced by a email-token system, when the user is authenticated from the email token, cookies will be used for session management to ensure they are automatically authenticated and can access their bookings, this feature will also auto write clients information when they want to book an appointment, ensuring a seamless experience for repeat customers, without the need for manual any manual information entries, the same goes for when they want to leave a review, the cookies will auto approve users that want to leave a review, if a user device does not have cookies enabled, the user will be prompted to enable them, if new device is used and client want to press my bookings/avbokning or leave a review using the email, if there is no cookies available an email will be sent to the user with a new token to access their profile. The optional consent category and related public copy needs to be updated to reflect the new email-token system.]`

### [#36 — Identify public customer input purposes with native HTML semantics](https://github.com/omar-y-abdi/KNC-STUDIO/issues/36) — P1

**What the issue is**

The agent claims public name, phone, and email fields lack complete native `type` and `autocomplete` attributes. `inputMode` only changes the keyboard hint; it does not identify the field's purpose.

**Why it is wrong**

Browsers and assistive technology get less information for autofill and input identification. This can make mobile entry harder and fails the project's stated accessibility target.

**What the suggested fix will do**

It will add `autocomplete="name"`, `type="tel"`/`autocomplete="tel"`, and `type="email"`/`autocomplete="email"` to public fields, with tests. Validation and submitted values should remain unchanged.

**Specific feedback needed before any PR**

- Approve the exact native attributes for booking, review, and My Bookings fields?
- Are there any fields intentionally excluded from browser autofill for privacy reasons?
- **Your decision:** `[x] Approve  [ ] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[This is approved, and needs to ensure it also follows the new email-token system, and the autofill attributes should be added to all fields automatically.]`

### [#37 — Fix gallery marquee clone focus and pointer-cancel behavior](https://github.com/omar-y-abdi/KNC-STUDIO/issues/37) — P1

**What the issue is**

The agent claims the looping gallery exposes repeated visual clones as separate keyboard buttons. It also claims a cancelled pointer gesture can be treated as a completed tap.

**Why it is wrong**

Keyboard users may tab through the same photo several times while the content moves. A cancelled touch or drag can trigger an action the user did not complete.

**What the suggested fix will do**

The preferred option removes per-photo button semantics and leaves the gallery as imagery plus drag/auto-scroll. If photo selection is required, the alternative exposes each logical image once, pauses on focus, and makes `pointercancel` abort without selection.

**Specific feedback needed before any PR**

- Is clicking/tapping a gallery photo a real product requirement?
- Approve removing photo selection and keeping only visual marquee behavior?
- If selection must stay, define what a selected photo should do and approve the accessible carousel behavior.
- **Your decision:** `[ ] Remove selection  [x] Keep selection with redesign  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Touch on image should select the image, holding and dragging should scroll the gallery. Touch then scroll should unselect image, scrolling should not select the image.]`

### [#38 — Harden public password recovery and expire its rate-limit ledger](https://github.com/omar-y-abdi/KNC-STUDIO/issues/38) — P0

**What the issue is**

The agent claims the public password-recovery endpoint accepts unauthenticated requests with no human/IP gate and creates a lasting rate-limit row for every unique valid-looking email.

**Why it is wrong**

Someone could generate many fake ledger rows or repeatedly trigger nuisance recovery emails for a known staff address. CORS does not stop non-browser callers.

**What the suggested fix will do**

It will reuse Turnstile, site-origin checks, and an IP-level limiter; add retention cleanup for old email-rate rows; and preserve neutral responses so account existence is not revealed. It changes the recovery flow and its operational limits.

**Specific feedback needed before any PR**

- Approve adding a Turnstile challenge to password recovery, including its user-facing flow?
- What per-IP, per-email, and global limits are acceptable for staff recovery?
- How long should rate-limit rows be retained for abuse investigation?
- Approve a migration that changes recovery endpoint/database limiter behavior?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [x] Need more evidence`
- **Your notes:** `[Password recovery already has rate-limiting, only apply turnstile same as the booking flow. This will ensure no bots can spam the password recovery endpoint, anything else seems overkill for this website (small business with barbers for auth only, not a high-traffic site).]`

### [#39 — Delete superseded public booking adapter/header paths](https://github.com/omar-y-abdi/KNC-STUDIO/issues/39) — P2

**What the issue is**

The agent claims old Supabase barber/service adapters are bypassed by the live shared catalog path. It also claims `BookingFlow.showHeader` is unreachable because all callers disable it.

**Why it is wrong**

Unused adapters, tests, and a dead hardcoded header branch create multiple apparent architecture paths. Future changes may update or rely on code the application never uses.

**What the suggested fix will do**

It will delete the bypassed adapters, test the actual shared catalog path, and remove `showHeader` plus its unreachable markup and caller flags. It should not add a replacement abstraction.

**Specific feedback needed before any PR**

- Confirm no external package, script, or deployment tool imports the old adapter modules.
- Confirm the standalone hardcoded BookingFlow header is not wanted as a future fallback.
- Approve deletion-only cleanup?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [x] Need more evidence`
- **Your notes:** `[Goal is to have nothing hard-coded, only admin and database driven configuration troughout the entire website, if any hard-coded values are found, they should be removed and replaced with database driven configuration. This is to ensure that the website is fully dynamic and can be easily updated without requiring code changes.]`

### [#40 — Remove known handoff documentation drift](https://github.com/omar-y-abdi/KNC-STUDIO/issues/40) — P1

**What the issue is**

The agent claims several README files, comments, environment notes, and navigation indexes still describe old Calendar, email, schedule, Vercel, or test paths.

**Why it is wrong**

An operator may change the wrong system, restore an unsafe legacy path, or search for a file that no longer exists. Incorrect handoff documentation is an operational risk.

**What the suggested fix will do**

It will update stale prose to match current code and migrations, correct Cloudflare wording, and either delete or clearly archive historical review material. It may alter documentation outside the application code.

**Specific feedback needed before any PR**

- Which documents are authoritative for handoff?
- Approve updating the named docs and comments to current behavior?
- Should `REVIEW_FINDINGS.md` be deleted, retained with an archive header, or preserved unchanged?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Nothing gets deleted, only archived for reference and historical purposes, all documentation should be updated to reflect the current state of the code and migrations, and any outdated information should be clearly marked as such.]`

### [#41 — Give icon-only booking dialog close buttons an accessible name](https://github.com/omar-y-abdi/KNC-STUDIO/issues/41) — P1

**What the issue is**

Two public booking dialog close buttons contain only the `×` glyph and have no accessible name. The agent compares them with the already-localized My Bookings close button.

**Why it is wrong**

A screen reader may announce the symbol instead of explaining that the control closes the dialog. Users can miss the action's purpose.

**What the suggested fix will do**

It will add the existing localized close label to the details and confirmation buttons without changing their visible appearance.

**Specific feedback needed before any PR**

- Approve reusing the existing localized close string and keeping the visible `×`?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Goal is no UX regression or visual change, only accessibility improvement, the existing localized close string will be reused and the visible × will remain unchanged.]`

### [#42 — Keep permanent My Bookings bearer out of the durable outbox](https://github.com/omar-y-abdi/KNC-STUDIO/issues/42) — P0

**What the issue is**

The agent claims the permanent customer token is copied as plaintext into durable outbox payloads. It also claims the infinite challenge row used for delivery can remain after the email succeeds.

**Why it is wrong**

The outbox is durable storage and may retain a credential through retries, snapshots, backups, or internal inspection. The unused challenge becomes permanent customer-related dead state.

**What the suggested fix will do**

It will queue only a challenge identifier, decrypt the canonical encrypted token immediately before sending, consume the challenge after successful delivery, and scrub any queued legacy plaintext payloads. Token rotation and customer authorization should remain unchanged.

**Specific feedback needed before any PR**

- Approve changing the database/Edge dispatch contract to identifier-only payloads?
- Approve a migration that scrubs queued payloads and changes challenge cleanup semantics?
- Require a fresh encrypted production backup and a staged rollout before deployment?
- Confirm existing customer-access links and retry/idempotency behavior must remain valid.
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[As written before, the permanent My Bookings bearer token is a deliberate design decision to be used as a permanent random root-path link for My Bookings access. We will preserve this design and not change it to fragment-only links. However, we will ensure that the token is not stored in plaintext in the durable outbox and that any legacy payloads are scrubbed.]`

### [#43 — Remove obsolete Calendar Database Webhook and rotate shared secret](https://github.com/omar-y-abdi/KNC-STUDIO/issues/43) — P0

**What the issue is**

The agent claims production has both a durable database trigger and an older Dashboard Database Webhook for Calendar changes. The older webhook also stores the shared credential in trigger metadata.

**Why it is wrong**

The two paths duplicate work, and the secret may be recoverable from database trigger metadata. Removing the wrong path could break Calendar sync, so this is a high-risk production change.

**What the suggested fix will do**

It will remove the Dashboard webhook, rotate the shared secret, update Edge/Vault parity, verify the durable trigger/outbox path, and then remove the unused `calendar-sync` function/config if no caller remains. It affects Supabase Dashboard, secrets, migrations, code, and operations docs.

**Specific feedback needed before any PR**

- Do you approve deleting the Dashboard webhook after durable Calendar sync is independently verified?
- Do you approve rotating `WEBHOOK_SECRET` and updating both Edge and Vault values during the same maintenance window?
- Who has Supabase Dashboard access to remove the webhook?
- Approve undeploying/removing `calendar-sync` only after a live caller/dependency check?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[No regression should be introduced when fixing this issue.]`

### [#44 — Delete unreferenced Task 2 visual-capture script](https://github.com/omar-y-abdi/KNC-STUDIO/issues/44) — P2

**What the issue is**

The agent claims `tools/visual/capture-task2.mjs` is a one-off harness with no caller, package script, CI use, or runbook authority.

**Why it is wrong**

It creates a second visual-testing path and contains temporary task language. Future maintainers may not know whether it is required.

**What the suggested fix will do**

It will delete the script and keep the supported `capture.mjs` plus `compare.mjs` gate unchanged.

**Specific feedback needed before any PR**

- Confirm nobody uses this script manually outside repository references.
- Approve deletion-only cleanup?
- **Your decision:** `[x] Approve  [ ] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Verify that this script is not used anywhere and can be safely deleted.]`

### [#45 — Remove unreachable workers.dev header rules](https://github.com/omar-y-abdi/KNC-STUDIO/issues/45) — P2

**What the issue is**

The agent claims `public/_headers` contains no-index rules for old `workers.dev` hosts while Wrangler disables both workers.dev and preview routes.

**Why it is wrong**

The rules describe routes that the current configuration does not serve and can make future deployment reviews misleading. The actual route controls are in Wrangler.

**What the suggested fix will do**

It will remove the two historical host blocks and leave `workers_dev=false` and `preview_urls=false` unchanged.

**Specific feedback needed before any PR**

- Confirm those historical hosts are permanently retired.
- Approve deleting only the two header blocks, with no replacement preview configuration?
- **Your decision:** `[x] Approve  [ ] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Ensure best practices are followed and no regressions are introduced when removing the unreachable workers.dev header rules.]`

### [#46 — Remove unused customer phone from Calendar dispatch contract](https://github.com/omar-y-abdi/KNC-STUDIO/issues/46) — P1

**What the issue is**

The agent claims Calendar dispatch resolves and transports the customer's phone number even though the Google event builder never uses it and intentionally excludes contact details.

**Why it is wrong**

The phone number moves through a privileged internal contract without affecting behavior. That increases unnecessary personal-data exposure and contract complexity.

**What the suggested fix will do**

It will remove `phone` from the database dispatch result, TypeScript action type, parser, and related tests. Calendar event output and retry behavior should not change.

**Specific feedback needed before any PR**

- Confirm phone must never appear in Google Calendar events or internal Calendar dispatch context.
- Approve removing it end-to-end while leaving booking contact data untouched?
- **Your decision:** `[ ] Approve  [ ] Approve with changes  [x] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Calender is used so that barbers have access to ALL customers information directly from their google calender. This is a deliberate design choice so that barbers dont depend on the website to view their costumers info.]`

### [#47 — Remove stale hardcoded sitemap lastmod dates](https://github.com/omar-y-abdi/KNC-STUDIO/issues/47) — P2

**What the issue is**

The agent claims both sitemap entries still say `lastmod` was `2026-08-09`, even though the homepage and privacy page changed later.

**Why it is wrong**

Search engines receive inaccurate change dates. A manually maintained date will drift again, especially when homepage content comes from the CMS.

**What the suggested fix will do**

It will remove both `lastmod` elements and keep the canonical URLs, `changefreq`, and `priority`. It will not add a sitemap generator.

**Specific feedback needed before any PR**

- Approve omitting `lastmod` until a reliable automated timestamp exists?
- Do you want a future automated sitemap task tracked separately?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[The website should have a future automated sitemap task to ensure that the sitemap is always up-to-date and accurate, and that search engines receive the correct change dates.]`

### [#48 — Drop retired phone-lookup and access-request RPCs](https://github.com/omar-y-abdi/KNC-STUDIO/issues/48) — P1

**What the issue is**

The agent claims four old customer database functions remain deployed: phone lookup, phone-listing, and two old access-request overloads. The current gateway uses permanent email-delivered tokens instead.

**Why it is wrong**

Unused privileged functions enlarge the database contract and make future security audits harder. The issue says current browser roles cannot execute them, so the claim is about dead surface rather than a current anonymous exploit.

**What the suggested fix will do**

It will drop exactly those four signatures, add absence tests, and update rollout docs. It will preserve `exchange_customer_booking_access(...)` and current permanent-token functions so existing compatibility links continue to work.

**Specific feedback needed before any PR**

- Confirm no external client, old frontend, support tool, or integration still uses phone lookup or old access-request creation.
- Confirm existing one-time links must continue through the exchange function.
- Approve permanent removal through a forward migration after dependency checks?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Phone-number is written to the database for barbers to have access to their customers information directly from their google calender, user facing cookies to manage their bookings and reviews is now managed through the email-token system, and the old access-request overloads are no longer needed as the new system is more secure and efficient. The permanent removal of these functions is approved after confirming that no external clients or tools still use them.]`

### [#49 — Drop remaining superseded booking/review RPCs and email trigger](https://github.com/omar-y-abdi/KNC-STUDIO/issues/49) — P1

**What the issue is**

The agent claims four other old functions remain: direct booking cancellation, direct review creation, an old phone rate helper, and the retired fire-and-forget confirmation trigger. Current gateway and durable email paths replaced them.

**Why it is wrong**

Unused privileged functions and old trigger logic add maintenance and security-review surface. Leaving them in place makes the running database contract look larger than the product.

**What the suggested fix will do**

It will drop exactly the four signatures with `RESTRICT`, update tests to assert absence, and keep current access-scoped cancel/review, atomic booking, and durable email functions. Open PR [#51](https://github.com/omar-y-abdi/KNC-STUDIO/pull/51) appears to implement this issue.

**Specific feedback needed before any PR**

- Should PR #51 be reviewed and merged as the implementation, or should its scope change first?
- Confirm no external client or old operational script calls the four functions.
- Approve closing #49 after PR #51 is merged and migration/pgTAP/live checks pass?
- **Your decision:** `[ ] Review/merge PR #51  [ ] Change scope  [ ] Reject/close  [x] Need more evidence`
- **Your notes:** `[This PR was written by Github Copilot, this has not been reviewed or tested. This is your goal, rewrite and fix all issues gh copilot has written, and ensure that all issues are fixed and tested properly.]`

### [#50 — Remove impossible anonymous barber-schedule Realtime subscription](https://github.com/omar-y-abdi/KNC-STUDIO/issues/50) — P1

**What the issue is**

The agent claims the public anonymous client subscribes to `barber_schedules`, but RLS allows schedule reads only to authenticated users. The initial schedule data still arrives through the public discovery RPC.

**Why it is wrong**

The listener appears to support live schedule updates but cannot receive them. Reopening anonymous schedule reads would weaken an intentional privacy boundary.

**What the suggested fix will do**

It will remove only the impossible schedule subscription, keep the public discovery RPC, and preserve authenticated-only schedule RLS. Other public Realtime invalidations remain.

**Specific feedback needed before any PR**

- Do you require live schedule-driven metadata updates on the public site?
- If not, approve removing the listener while keeping the current RLS policy?
- If yes, define a public-safe invalidation design instead of reopening schedule reads.
- **Your decision:** `[ ] Remove listener  [ ] Design public-safe live updates  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Dont know what this means, do whatever is best for the website, if it is not needed, remove it, if it is needed, design a public-safe live update system.]`

### [#52 — Protect main so CI is a merge gate](https://github.com/omar-y-abdi/KNC-STUDIO/issues/52) — P0

**What the issue is**

The agent claims `main` has no branch protection or ruleset. Existing CI runs, but GitHub does not require those checks before a direct update to `main`.

**Why it is wrong**

Broken code can reach the default/production source branch before CI reports failure. Force-pushes or branch deletion may also be possible for normal writers.

**What the suggested fix will do**

It will add GitHub branch protection or a ruleset requiring the existing frontend/browser, Edge Function, and database/integration jobs, while blocking force-push and deletion with minimal bypass access.

**Specific feedback needed before any PR**

- Should all changes to `main` require a pull request, or are direct owner pushes allowed?
- Approve requiring the three named CI jobs before merge?
- Who may bypass rules, and under what emergency conditions?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Protect main from being force-pushed or deleted. Any mistakes an agent might make need to be blocked by the branch protection rules, and all changes to main should require a pull request, with the CI jobs required before merge.]`

### [#53 — Harden Supabase Auth settings](https://github.com/omar-y-abdi/KNC-STUDIO/issues/53) — P0

**What the issue is**

The agent claims Supabase Anonymous Sign-Ins are enabled even though the app has no anonymous-auth flow, and Auth one-time-link/OTP expiry is longer than one hour.

**Why it is wrong**

Unused anonymous sign-in can create unnecessary Auth users and resource consumption. A longer one-time-token lifetime gives a leaked recovery, invite, or email-change token more time to be used.

**What the suggested fix will do**

It will disable Anonymous Sign-Ins, set OTP expiry to 3600 seconds or less, rerun Security Advisor, and smoke recovery, invite, and email-change flows. It changes hosted Supabase settings, not application code.

**Specific feedback needed before any PR**

- Confirm no current or planned feature depends on Supabase Anonymous Auth.
- Is one hour acceptable for staff recovery, invites, and email changes, or do you want a shorter value?
- Approve changing production Auth settings and running the related smoke checks?
- **Your decision:** `[ ] Approve  [x] Approve with changes  [ ] Reject/close  [ ] Need more evidence`
- **Your notes:** `[Disable all unused supabase features, make sure that it is not used before doing it.]`

## How to proceed after your feedback

1. Fill in a decision and notes section for every issue you want considered. Do not treat P0 as automatic authorization.
2. For **Need more evidence**, ask the agent for current code references, live read-only evidence, dependency checks, or a reproduction before any implementation PR.
3. For **Approve with changes**, write exact scope, product behavior, rollout, and rollback conditions. The agent should update the issue or PR plan before coding.
4. For **Reject/close**, record why. Do not leave a rejected security or legal concern implied as accepted.
5. For approved code work, require tests matching the claim: unit tests for pure logic, pgTAP/integration for database behavior, and browser/provider checks for live behavior.
6. For production changes, require explicit action-time approval for data creation/deletion, secret rotation, dashboard changes, migrations, and smoke tests that touch real data.
7. Close an issue only after its acceptance conditions are evidenced. A local green build does not prove production settings, provider delivery, inbox placement, browser behavior, or deployed database state.

## Suggested first feedback pass

Start with decisions that block handoff:

- **Owner/legal:** #22, #27, #33.
- **Production/security:** #23, #25, #38, #42, #43, #52, #53.
- **Database contracts:** #26, #31, #32, #46, #48, #49.
- **Customer-facing behavior:** #24, #30, #36, #37, #41.
- **Cleanup/docs:** #29, #34, #35, #39, #40, #44, #45, #47, #50.

No PR fix should proceed until your feedback resolves the relevant section.
