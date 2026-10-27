# PR91 follow-up: backup initialization and Studio exit

## Scope and source

- Incoming report IDs F1 and B1; these are distinct from the previous PR90 findings.
- Frozen source: `d800bad059271da7624bf0ae98e79ba2a1fb313f` in `/tmp/knc-pr91-backup`, branch `review/pr91-backup`.
- Edit existing backup lifecycle behavior, with no new dependencies, production actions, remote writes or owner-content changes.
- Own `src/admin/cms/backup.ts`, the exit/backup scheduling sections of `src/admin/cms/Studio.tsx`, and their scoped regression tests. The adoption author owns the separate restore interaction.
- Use port offset 200 and isolated red/green artifacts under `/tmp/knc-audit/pr91-backup-red` and `/tmp/knc-audit/pr91-backup-green`.

## Acceptance and plan

- [x] Read the supplied F1/B1 sections, root plan and actual source/test conventions.
- [x] Add correct-behavior regressions and reproduce both failures before product edits.
- [x] Repair only the confirmed causes; preserve cross-tab exclusion and existing lifecycle protections.
- [x] Verify unit contracts and relevant real Chromium/WebKit lifecycle behavior; independently review the repair.
- [x] Record exact receipts and limits, then commit scoped verified changes for coordinator integration.

F1 acceptance: a failed local-store initialization followed by a same-page retry must preserve access to the original backup using the same persistent records and lock manager. A real browser regression must abort an IndexedDB read, exit/unmount Studio and reopen without reloading the page.

B1 acceptance: trusted inspector input followed by the actual Studio exit button before the canvas debounce fires must persist the final edit and show it after same-page reopen. Natural probes establish reachability without a paused clock. The committed regression controls only the debounce clock so CI is not required to complete native actions within 180 ms of wall time. Neither probe nor regression uses a synthetic click or direct canvas model edit.

## Diagnosis

- F1: `claimTab` holds a lifetime Web Lock before `replayJournal`, `migrateLegacy` and the initial `own` read. A rejected read makes `cmsBackups` forget its promise but leaves that lock held. The next initializer treats its own old identity as another live tab.
- B1: the exit handler calls `editor.flush()` and immediately `onExit()`. This mutates the current `CmsDraft`, but unmount can precede its next layout effect. Cleanup flushes only the older scheduled backup, so the latest canvas edit is never submitted.
- Confirmed repair direction: release exactly the lock acquired by a failed initializer; synchronously schedule the current draft immediately after exit's editor flush and before unmount. Successful backup session and adoption APIs remain unchanged. `TabLocks.claim` will return an owned release callback rather than a Boolean, avoiding a separate global registry or reentrant-claim behavior.

## Verification receipts

### Red evidence before product changes

Product blobs during these runs: `backup.ts` = `f944eec04be2535660ca596a5eae33d953861b30`; `Studio.tsx` = `b0afbe5dcbf846f68628321dfa16eabf5e5daf27`, unchanged from frozen `d800bad`.

- `npx vitest run tests/unit/cmsBackup.test.ts --testNamePattern='initialization'`: three intended failures, each selecting `tab-1` instead of `original` after an initialization failure (first read, second read, or identity storage write). The other 41 cases are filtered out for this red run, not skipped coverage claimed as executed. Log: `/tmp/knc-audit/pr91-backup-unit-red.log`.
- `E2E_PORT_OFFSET=200 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-backup-red npx playwright test tools/e2e/cms-lifecycle.spec.mjs --grep 'failed backup initialization|immediate Studio exit'`: F1 fails at the intended recovered-name assertion in Chromium and WebKit after real asynchronous `IDBTransaction.abort()` and same-page exit/reopen. Original IndexedDB content remains intact before exit. B1 fails at the missing-IndexedDB-content assertion in Chromium; trace proves trusted input/click 80.7 ms apart and the changed text still in the canvas at exit.
- The first browser attempt used the button title as its accessible name, so it could not click the exit button; this setup failure was corrected to a title locator and is not product evidence. In the corrected four-case red run, WebKit B1 crossed the test's 180 ms precondition at 194 ms; that outcome is not a product reproduction.
- Focused natural B1 red: `E2E_PORT_OFFSET=200 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-backup-red-exit npx playwright test tools/e2e/cms-lifecycle.spec.mjs --grep 'immediate Studio exit'`. Resolving the button before editing removes locator work between the trusted native input/click. Both engines fail at the intended missing-IndexedDB-content assertion. Trace timestamps: Chromium 102.8 ms; WebKit 116 ms. These probes use no paused clock, synthetic click or direct model edit. The exact source is preserved at `/tmp/knc-audit/pr91-backup-natural-lifecycle.spec.mjs`; log/artifacts use the same `red-exit` prefix.
- Final deterministic B1 red: the same command with artifacts/log prefix `/tmp/knc-audit/pr91-backup-red-controlled` fails at the same content assertion in both engines. It pauses the existing Playwright clock only to hold the 180 ms/500 ms debounce timers; real trusted input, click/unmount and IndexedDB operate normally. This is the committed form, avoiding a flaky wall-time threshold in CI.

### Implemented changes

- `TabLocks.claim` returns a callback tied to the acquired native request. An unavailable lock returns null. A failed identity write, journal replay, legacy migration or initial own-record read invokes that callback and waits until the lock request completes before the factory can retry. Successful sessions retain their lock until page destruction. There is no global lock registry or new dependency.
- Studio's exit handler calls the existing `scheduleBackup()` after `editor.flush()` and before `onExit()`. The existing unmount cleanup flushes that newly scheduled final document. Page lifecycle warnings, journal behavior and adoption remain unchanged.

### Green verification

- `npx vitest run tests/unit/cmsBackup.test.ts tests/unit/cmsIndexedDb.test.ts`: **54/54 passed**, two files, zero filtered cases. `/tmp/knc-audit/pr91-backup-unit-green.log`.
- `npm run typecheck`: passed. `/tmp/knc-audit/pr91-backup-typecheck.log`.
- `npx eslint src/admin/cms/backup.ts src/admin/cms/Studio.tsx tests/unit/cmsBackup.test.ts tools/e2e/cms-lifecycle.spec.mjs`: passed. Scoped ESLint initially found four missing `globalThis` qualifiers in the new browser fixture; corrected without changing the exercised behavior. `/tmp/knc-audit/pr91-backup-lint.log`.
- `npx prettier --check src/admin/cms/backup.ts src/admin/cms/Studio.tsx tests/unit/cmsBackup.test.ts tools/e2e/cms-lifecycle.spec.mjs docs/pr91-followup/01-backup-lifecycle.md` and `git diff --check`: passed.
- Browser command: `E2E_PORT_OFFSET=200 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-backup-green npx playwright test tools/e2e/cms-lifecycle.spec.mjs --grep 'failed backup initialization|immediate Studio exit|closed tabs keep|flushes the draft|an edit survives|a canvas edit|a reload right after|actual close warns|a pending source upgrade'`: **20/20 passed**, 5.1 minutes. It covers ten relevant cases in each of Chromium/WebKit, including real close/Cancel/quiet close, hidden/reload durability, recovery read failure/retry, source-upgrade race and the two new regressions.
- The matching discovery command used the same file/grep plus `--list --reporter=json` and wrote `/tmp/knc-audit/pr91-backup-green-expected.json`. `node tools/ci/verify-playwright-report.mjs /tmp/knc-audit/pr91-backup-green-expected.json /tmp/knc-audit/pr91-backup-green/test-results/results.json` passed: **20 discovered/executed cases, no skips, retries or missing outcomes**. Native JSON reports expected 20, skipped 0, unexpected 0, flaky 0, errors `[]`.
- Preserved natural B1 green: copy the unchanged natural probe to temporary `tools/e2e/cms-backup-natural.spec.mjs`, then `E2E_PORT_OFFSET=200 E2E_ARTIFACTS_ROOT=/tmp/knc-audit/pr91-backup-green-natural npx playwright test tools/e2e/cms-backup-natural.spec.mjs --grep 'immediate Studio exit' --project=cms-chromium --trace on`. **1/1 passed**, 15.4 seconds. Trace proves trusted input and exit 44.4 ms apart, changed text in the canvas at exit, final text durable in IndexedDB and present after reopen. No clock control or direct canvas model change. The temporary repository copy was removed; the preserved source and traces remain in `/tmp/knc-audit`.
- Stable tested blobs, rechecked after the complete green run and natural probe: `backup.ts` `d0d122703f52527151c0bfe9a2add82741d4eefb`; `Studio.tsx` `383275ecb694f2fe2aa13f44f0c384e53b4c8188`; `tests/unit/cmsBackup.test.ts` `05a67f6c0510bf07c1f99cdaf35de41d673a04f2`; `tools/e2e/cms-lifecycle.spec.mjs` `ce7c6fb93ce957197c02f9b9582b8fa99c3e4335`.

### Independent review and disposition

The coordinator independently read the product diff and initialization/claim/schedule callers and found no source blocker. In particular, the release handle belongs only to the failed initializer, native completion is awaited before factory reset/retry, successful/other-tab locks are preserved, and exit scheduling reads the current refs after the synchronous canvas flush. The author has completed the planned checks and stops optional expansion here.

F1 and B1 are accepted and repaired within the tested boundaries. The separate adoption author owns F2; this change does not alter `BackupSession.adopt` or migration-aware adoption policy. Final integrated cross-review and exact-head CI belong to the coordinator after cherry-picking the independently authored workstreams.

Existing `d800bad` CI is a baseline and does not close these newly reported boundaries.

## Limits

- Browser tests use actual Studio, GrapesJS, IndexedDB and Web Locks with the repository's local backend fixture. They do not execute production authentication, production publication or the production router.
- B1 is reported on base and head; it is an existing exit bug, not a newly attributed PR regression. This follow-up independently inspected base's identical flush-then-exit sequence, and independently executed head. It has not rerun the base browser reproduction.
