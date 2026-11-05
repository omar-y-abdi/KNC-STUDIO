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

## Approved follow-up qualification

The next hosted run (`42103454710`, `bd65445`) passed lint/type checks, units, CodeQL and the
CMS publication groups that had rejected the private marker. Production compilation succeeded,
but public boot reached 122.0 kB against the unchanged 115 kB limit. Mobile and desktop layouts
now load as separate renderer modules; a mobile layout includes all morph code before becoming
interactive. App preview readiness and viewport metadata wait for that selected renderer.
Controlled browser cases cover a held mobile-module response and a failed request followed by reload.

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
The renderer now reports its committed mount; preview readiness and viewport colors use that
signal. Suspense alone owns the import and its visible reload action. The privacy contrast fixture
waits for the same two required hero labels rather than counting before asynchronous mounting.

The review fixture trace showed WebKit filling offscreen fields while the hero was still onscreen.
Its first star click then scrolled into About and started deferred data/layout work; no star became
checked. The fixture now enters About, waits for its published data, scrolls to the form and verifies
the selected rating before submitting. The real HTTPS-cookie customer flow already passed.

Twelve stored mobile reference images were updated from that hosted run after reviewing the
rendered images and diffs. Resting changes are SVG text rasterization; the folded dark references
reflect the approved banner/phone appearance. Screenshot tolerances, contrast requirements,
viewport color assertions and request-count assertions remain unchanged. No local suites ran.
