# Hero-to-banner motion: user-approved implementation

The user approved a six-pose visual storyboard, then specified that the thin rules above and
below BNB must fade in with the phone number after the banner arrives. The implementation below
replaces the rejected sequential shrinking/sideways movement and whole-logo crossfades.

## Observable sequence

- Supporting hero details and buttons fade progressively while remaining below the wordmark.
- The two B glyphs and the ampersand use compatible outlines derived from the shipped Playfair
  Display fonts. The same three paths change shape and arrangement into BNB; a separate BNB text
  is not substituted for the symbol during the transition.
- The monogram reaches a horizontal arrangement beside BLADE & BLEND before the group reaches
  its final header position. There is no separate final sideways leg.
- Source and destination word weights share a baseline and width in one private header SVG.
  This avoids compositor scrolling one text copy before JavaScript updates the other.
- SV/EN and theme controls remain visible and usable. Only the phone fades out and returns.
  The BNB rules and returning phone use the same final opacity progression.
- Every pose depends on scroll position; reversing scroll reverses the same geometry.
- Reduced motion keeps the fade behavior without decorative glyph travel. Uploaded owner images
  remain intact and use the existing image fallback rather than being decomposed into glyphs.

Native scroll carriers, bounds, priming, booking lifetime and scroll positions are unchanged.
The controls move into their final row with a transform instead of a timed layout-margin change.
Glyph/layout measurements are cached outside scroll painting. Scroll paints write path coordinates,
transforms and opacity without font reshaping or synchronous glyph measurements.

## Mobile navigation timing restoration

The iPhone follow-up found that clicking into booking skipped this choreography. Commit
`809160b` removed the original `height .66s cubic-bezier(.32,.72,0,1)` transition; `5c6d9b8`
then placed booking at its final scroll position in a layout effect. About navigation used
browser-controlled smooth scrolling, which supplies no fixed duration.

Mobile section clicks now drive the existing scroll-linked choreography with the original
660 ms duration and exact CSS easing. About, booking and return-to-hero use this timing; a
new gesture cancels it immediately. Direct booking URLs, CMS scene entry and reduced-motion
navigation retain their immediate positioning. Native manual scroll and the morph geometry
are unchanged: both the historical and current fold map one scroll pixel to one collapse pixel.
There is no measured evidence that iPhone gesture velocity itself doubled. The regression checks
cover intermediate click poses, timing, interruption and unchanged content travel in the existing
public browser matrix, with source and persisted CMS fixtures. Physical iPhone pacing still needs
the owner's assessment; automated verification runs on GitHub only.

## CMS boundary

The editable SVG hierarchy and identities are retained. The private runtime artwork is marked
`data-knc-brand-runtime`, has no editable identities, and is removed from snapshot clones before
source identity allocation. Original motion-owned styles are restored on the clone only. The private glyph-part markers are
also removed; the saved document continues to use the existing native metadata contract.
An assertion in the existing CMS-native capture fixture covers artwork removal and live-tree
preservation. The canvas and public site share the motion calculation and geometry lifecycle.

`tools/brand/morph-paths.mjs` regenerates compatible glyph contours from the repository's existing
OFL-licensed fonts using its existing fontkit dependency. No font parser or new dependency is added
to the browser. Font provenance and license remain in `public/fonts`.

## Verification boundary

The primary agent implemented the storyboard correction directly after the user's instruction
not to delegate further. Manual Chrome inspection covered the start, intermediate and final poses,
plus a forward/reverse capture. Capture exposed and prompted correction of text-layer separation.
The resulting forward capture shows one aligned wordmark and the delayed phone/rule reveal.

Chrome viewport size changed during the later part of a recording; those resized frames are not
accepted as a full-resolution reverse-motion artifact. Physical iPhone Safari smoothness is not
established by these captures. The user accepted the final mobile Chrome preview at commit `d196431`.

Focused motion and CMS capture checks were updated but not run locally. Automated tests and builds
remain restricted to GitHub Actions. No production deployment, migration or final PR publication
has been performed for this storyboard candidate. The manual preview has hot updates disabled so
unfinished edits cannot appear in the user's open tab.

The first remote qualification passed all current SQL tests and 93 integration tests, including
the eight device-review integration cases. Frontend and customer browser qualification stopped
on TypeScript DOM overload errors; CMS publishing rejected a private glyph marker that should
not have been persisted. The follow-up replaces non-null assertions with typed glyph tuples,
uses DOM appendChild, and strips the marker in capture without relaxing markup validation.
The approved shape coordinates and animation behavior are unchanged.

## Historical follow-up qualification

The next hosted run (`42103454710`, `bd65445`) passed lint/type checks, units, CodeQL and the
CMS publication groups that had rejected the private marker. Production compilation succeeded,
but public boot reached 122.0 kB against the unchanged 115 kB limit. At that checkpoint, mobile and desktop layouts
were split into asynchronously loaded renderer modules. This introduced an unrequested full-page
"Laddar …" state. The user approved the hero animation, not this startup behavior; the loading
implementation is withdrawn below.

The real customer suite also caught an authored ampersand-opacity rule being overwritten at home
rest. Source glyphs now retain their original opacity cascade at rest; animation opacity multiplies
the author's values, including in the runtime layer, instead of replacing them with opaque values.
The existing first-paint test retains its exact 0.18 assertion.

Following the user's explicit instruction after manual acceptance, the nine newly introduced
Chromium paint-diagnostic cases were retired. Their stationary-phone premise contradicts the
approved phone fade/return, and their Linux synthetic-touch input was already proven unreliable.
No pre-existing main-branch tests, security checks, budgets, accounting or retries were weakened.
Booking-scroll, keyboard, viewport, source/canvas, first-paint and customer/browser coverage remain.
The retired diagnostic implementation remains available in Git history at `bd65445`.

Hosted run `42108123897` at `46fb790` passed static/unit checks, the production budget and
startup checks, Edge checks, historical migrations, current SQL, integration, and the complete
real customer-browser job. Its source artifact tree matched the pushed tree exactly.

The remaining browser findings exposed two renderer-readiness mistakes: a separate import probe
could retry a rejected import in WebKit, and import completion could precede the actual DOM mount.
That follow-up added a renderer mount signal and kept the Suspense loading screen. Those
layout-only mechanisms are also withdrawn below. The privacy contrast fixture
waits for the same two required hero labels rather than counting before asynchronous mounting.

The review fixture trace showed WebKit filling offscreen fields while the hero was still onscreen.
Its first star click then scrolled into About and started deferred data/layout work; no star became
checked. The fixture now enters About, waits for its published data, scrolls to the form and verifies
the selected rating before submitting. The real HTTPS-cookie customer flow already passed.

Twelve stored mobile reference images were updated from that hosted run after reviewing the
rendered images and diffs. Resting changes are SVG text rasterization; the folded dark references
reflect the approved banner/phone appearance. Screenshot tolerances, contrast requirements,
viewport color assertions and request-count assertions remain unchanged. No local suites ran.

## Withdrawal of the unrequested homepage loading screen

The follow-up restores direct imports and synchronous rendering of MobileSite and DesktopSite.
The full-page LazySurface wrappers, siteLayouts module, and layout readiness state/callbacks are
removed. The two tests that enforced layout loading/reload are replaced by first-render checks
for mobile and desktop: the hero and booking control must exist before yielding to a promise,
without a visible layout-loading status. Booking/dialog-specific loading boundaries and the
existing CMS presentation gate retain their established behavior. Hero motion is unchanged.

Verification for this withdrawal runs in GitHub Actions; no local automated suites or builds run.

Run `42119610488` built the restored eager homepage successfully and measured 122.3 kB gzip.
The owner explicitly approved changing the boot budget from 115 to 123 kB to finish this
withdrawal without another change to the website's startup behavior. Boundary checks retain
both accepted and rejected sizes around the new limit.
