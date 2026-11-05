# Hero-to-banner motion: approved storyboard candidate

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
source identity allocation. Original motion-owned styles are restored on the clone only.
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
established by these captures. Final visual acceptance belongs to the user's mobile preview.

Focused motion and CMS capture checks were updated but not run locally. Automated tests and builds
remain restricted to GitHub Actions. No production deployment, migration or final PR publication
has been performed for this storyboard candidate. The manual preview has hot updates disabled so
unfinished edits cannot appear in the user's open tab.
