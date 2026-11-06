# Mobile first paint and keyboard follow-up

Base: PR #173, `b8b7d00c93f632509054e98ed279284f996e7291`. This follow-up corrects three
remaining reports; the earlier QA document's successful post-verification geometry did not
establish compact first-render geometry.

## Read-only production evidence

Checked 2026-11-05; no deployment, database migration, CMS write, booking or review submission.

- Cloudflare deployment `da72a9ac-f201-4299-b7db-8397495d8c01`, version
  `02481c67-28ff-4fd5-9648-be501821a127`, created `2026-11-05T09:21:38.980599Z`, 100% traffic.
- Public entry `/assets/BcgGZ-Vw.js`, SHA256
  `c2657698cff7a5e413fcfb492210e8d64178d88acba22fb61e06e6dfe036676c` contains the PR #173
  pending-65px reservation. This is a current source behavior, not an old cached pre-fix asset.
- Public CMS revision 57, response SHA256
  `247259a9c69ed8213fd9a1268705e055b0d62d574166bd05e16d1ada8b5f500d`.
  The home page equals the committed revision-56 fixture; booking CSS also equals that fixture.
  Production does not override the mobile controls header's position. No CMS mutation is needed.
- Authenticated Cloudflare widget GET confirms the configured production key's mode is
  `invisible` (last modified `2026-08-09T17:21:39.465122Z`). Only public widget metadata was retained.
- Supabase migration history confirms `20261105074335_device_booking_contact_prefill.sql` is
  already applied. It adds a contact hint to the customer listing response, not dialog geometry.

Local receipts: `/tmp/booking-first-frame-{shell.html,shell.headers,cms.json,cms.headers,widget.json,migrations.json}`;
downloaded observed asset graph: `/tmp/booking-first-frame-live-assets/` and its JSON manifest.

## Booking first frame

The old component reserved 65px for every pending widget and released it on success. Production's
invisible widget has zero footprint throughout, so success moved the button and shrank the dialog.
Superseded 2026-11-06: the widget-mode build variable and contract introduced here were removed
again; the container now reserves no height in any status, and a visible widget sizes it only
once it renders. No appearance/execution/security option was changed; token and server
verification remain authoritative.

[Cloudflare's widget configuration documentation](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
distinguishes the normal 300×65 widget from invisible widgets' zero footprint regardless of size.

The real built public App test opens Details with stored CMS presentation, holds the provider
script for at least 90 animation frames, then inserts a deterministic zero-height provider iframe
and completes verification. It records geometry from the first DOM insertion, before any success
callback. The button stays disabled until a valid callback. Reduced and normal motion are covered.
Old build: height 714px pending →649px ready, both WebKit cases fail. Fixed build: all recorded
pending frames equal ready geometry. These are layout pixels, independent of dialog animation scale.
Red receipt: `/tmp/booking-first-frame-red/test-results/results.json`.

## Home theme sampling

Live mobile-emulated Chrome confirms html/body/header/theme metadata already change on click
without a scroll. The remaining source defect is the controls header's `position:sticky` with
both vertical insets auto: it does not stick, but registers as a viewport-constrained object.
It is now relative with the same stacking level. The surrounding panel retains real compact
pinning; DOM identity, owner styling, fold geometry and privacy scrolling remain intact.

The [CSS positioning specification](https://drafts.csswg.org/css-position/#stickypos-insets)
defines the inset-free behavior. Engine evidence is pinned to WebKit commit
`c5bdf94bf481c781aba9c82ca51eb3045a850949`:

- [WebPageCocoa sampling gate](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebKit/WebProcess/WebPage/Cocoa/WebPageCocoa.mm#L2447)
  only refreshes fixed-container edges when its update flag is set.
- [Viewport-constrained object notifications](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebKit/WebProcess/WebPage/WebPage.cpp#L11637)
  set that flag; plain color changes are not equivalent to adding/removing such an object.
- [LocalFrameView edge selection](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebCore/page/LocalFrameView.cpp#L2332)
  examines fixed/sticky ancestors and applies viewport-size classifications.

Regression checks require no home fixed/sticky candidate, correct real compact candidates,
relative controls headers, unchanged fold coordinates and correct document colors in the first
five animation frames after a theme click, with scroll position zero. Source and stored layouts,
booking/home navigation, About scrolling, privacy panel, modal and normal-motion entry are covered.
The old inert sticky fails the candidate assertion:
`/tmp/mobile-inert-sticky-red/test-results/results.json`.

This removes a concrete unnecessary cache participant; physical iPhone Safari chrome repaint
has **not** been verified. Desktop WebKit does not render iOS browser chrome. Safari also retains
sampling history for genuine compact sticky panels; native-device validation of navigation
history remains necessary. No artificial scrolling, forced repaint hook, dummy surface or delay
was added.

## Keyboard fold geometry

The old fold limit used `window.innerHeight`, while the actual panel used CSS `100dvh`.
When keyboard-visible viewport geometry differs from the CSS layout box, the computed collapse
shrinks and the header expands. The fold now reads its actual scroll-root CSS height plus the
explicit privacy reservation; resize observations cover real layout changes too. The editing
canvas uses the same measurement.

[VisualViewport documentation](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
describes keyboard changes to the visual viewport without the same layout-viewport change.
The regression focuses the real telephone and review fields, models independent delayed
keyboard resize/pan events, restores them, and resizes the real mobile layout. It preserves focus,
draft and a 112px header. Old code expands 112→356px at modeled innerHeight 600 while CSS height
stays 844; red receipt `/tmp/mobile-keyboard-red/test-results/results.json`.
This is an explicit geometry/event model, not an actual native-keyboard test.

Unrelated observed limitation: crossing the desktop breakpoint remounts About and loses its
unsent review draft. The keyboard regression stays within mobile widths; this follow-up does
not change cross-layout draft ownership.

## Verification

- `npm run typecheck`: passed.
- Focused Turnstile mode/lifecycle/server-verification and mobileFold units: 32 passed in 4 files.
- Production build with local fixture backend overrides: passed.
- Cross-engine first-frame, viewport, keyboard and visible late-provider tests: 42 passed across
  Chromium, Firefox and WebKit; `/tmp/mobile-first-paint-final/test-results/results.json`.
- Focused ESLint check: passed. Vite emitted existing harness legal-HTML import warnings and one
  transient module-import rejection during navigation; the 42 assertions completed successfully.
- Browser ports use offset 500; no production write was exercised.

First-frame screenshots and geometry annotations live under the final receipt's evidence paths.
The challenge is deterministic in these tests; real Cloudflare configuration was checked
separately through its authenticated read-only API.
