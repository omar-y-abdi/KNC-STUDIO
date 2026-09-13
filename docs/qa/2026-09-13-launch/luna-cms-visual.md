# Luna CMS visual QA — 2026-09-13

Chrome extension QA used the existing `tools/e2e/admin-harness` on Vite `:4188` and an isolated Wrangler on `:8790` backed by local Supabase. Fictitious CMS values were installed locally, exercised, and restored; no production writes or product edits were made.

- AdminSiteView owner harness: legal name and registration fields are visible, blank by default, accept draft values, and their save controls return `Saved`; the mobile 390px view has no horizontal overflow. Real CUA screenshots were emitted and inspected for desktop 1280px and mobile 390px.
- Populated `/terms` and `/privacy`: current fake legal identity, email, phone, address, and 72-hour cancellation policy appear in browser DOM and source; one `h1`, expected canonical, no `<script>`, no console warnings/errors, and no horizontal overflow at 1280px and 390px. Keyboard Tab focuses the Home link.
- Blank legal fields: both public pages omit legal-name and registration-number labels and values while retaining contact details. Local SQL probe confirms trim, `5561234567` → `556123-4567`, invalid org/overlong legal name rejection, and blank allowance.
- Local HTTP: `/terms` and `/privacy` are `200` with `Cache-Control: no-store`; slash and `.html` aliases are `308` to canonical paths; `HEAD /terms` returns zero body; unknown path is `404`.
- Initial targeted unit command: 32 passed, 1 failed because the discovery test expected the former generic title. The CMS code agent corrected that expectation to the page-specific Google Calendar title before the final unit run; all 614 unit tests subsequently passed.

Artifacts: `/tmp/cms-visual-artifacts/` (`terms-local.html`, `privacy-local.html`, `http-routes.json`, `cms-constraints.json`, restore check, and harness evidence). During Vite HMR on the first active harness, one transient `GalleryMarquee` “photos is not iterable” entry appeared at `src/about/GalleryMarquee.tsx:413`; two fresh single mounts were clean, so it is not a reproducible CMS product failure.

## Live cancellation/calendar read-only gate — 2026-09-13

- Gmail Chrome tab confirmed signed-in Tara Ali (`sakta.tara.ali@gmail.com`). Search `subject:"Avbokningsbekräftelse"` returned one inbox message from Blade & Blend Studio. Open body confirms `Din tid är avbokad`, `Launchtest Tara`, Monday 21 September 2026 at 09:30, and that the time is no longer active under My appointments.
- Google Calendar Chrome tab confirmed the same Tara Ali account. Day 17 September shows one event `Omar Abdi — lol`, 09:15–10:15; day 21 September has no Launchtest Tara or 09:30 event; day 23 September shows exactly two `Omar Abdi — lol` events, 09:00–10:00 and 11:15–12:15.
- CUA screenshots were emitted and visually inspected for the cancellation email, empty 21 September, and populated 17/23 September calendar views. No booking, cancellation, OAuth, calendar mutation, or message was sent. Detailed evidence: `/tmp/cms-visual-artifacts/live-cancel-calendar-evidence.md`.
