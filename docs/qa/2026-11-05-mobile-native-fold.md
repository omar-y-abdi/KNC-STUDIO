# Mobile hero fold: native scroll geometry

This follow-up replaces the scroll-position compensation in `8054227`. The earlier first-paint,
keyboard, reversible-booking and review-recovery commits remain separate checkpoints. This is a
frontend/CMS layout change; it requires no Supabase migration, customer-data change or Cloudflare
binding change.

## Cause and implementation

The old panel was relative during the fold. An rAF-driven `translateY(scrollTop)` cancelled its
native scrolling, while an equal height reduction and spacer preserved the content position.
Compositor scrolling could advance before those JavaScript updates reached paint. Removing the
rAF did not fix that ordering: actual painted controls still moved during a native gesture.
An early rAF DOM measurement alone was not sufficient proof; the regression now captures rendered
Chromium frames using CDP screencasting and real native touch gestures.

Making the panel sticky fixed its top but exposed a second error: the JavaScript-controlled bottom
lagged behind the natively scrolling body. The rejected compact-carrier experiment had 294 wrong
bottom junctions in 344 frames. A correctly attached native ScrollTimeline height animation also
failed the junction test. Neither implementation is in this patch.

The final layout uses ordinary native sticky geometry:

- A full-height outer carrier scrolls until its bottom reaches the existing 112px compact boundary.
- A header carrier inside it pins the existing controls and corner mark at the top.
- The visual panel stays one CSS viewport tall. Its visible lower edge is
  `max(112px, viewportHeight - scrollTop)`; the body remains at `viewportHeight - scrollTop`.
- `overflow: clip` preserves the panel's rounded corners without introducing an intermediate
  scroll container. See [CSS Overflow 3, clipping](https://www.w3.org/TR/css-overflow-3/#valdef-overflow-clip)
  and [rounded clipping](https://www.w3.org/TR/css-overflow-3/#overflow-properties).
- No scroll-dependent transform, panel height or spacer height is written. JavaScript still owns
  the existing opacity/compact-control state and privacy behavior.

The visible home and compact endpoints are preserved. The intermediate hero content now scrolls
naturally upward beneath the header, instead of being re-centered inside a JavaScript-shrinking
box. Normal/reduced-motion preferences retain their existing control/opacity behavior. There is
no ScrollTimeline dependency or separate Firefox animation fallback.

## Resting theme and ownership boundaries

Both carriers use `display: contents` at home rest. Their first actual movement is primed before
the native pan, wheel, scrolling key or explicit section navigation. Ordinary taps and Space on
the theme button do not activate the carrier. No handler cancels or forwards native scrolling.
The one blocking touchmove listener removes itself after priming. Both carriers return to their
renderer-free resting state at zero after the active touch ends.

This matters to WebKit's fixed-edge cache. At pinned source revision
[`c5bdf94bf481c781aba9c82ca51eb3045a850949`](https://github.com/WebKit/WebKit/tree/c5bdf94bf481c781aba9c82ca51eb3045a850949),
[LocalFrameView::fixedContainerEdges](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebCore/page/LocalFrameView.cpp#L2332)
identifies a fixed/sticky ancestor, and
[Page::updateFixedContainerEdges](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebCore/page/Page.cpp#L5849)
can retain an old element's color while its renderer remains present. A resting carrier has no
renderer, so that particular retention path cannot reuse it. The relative visual panel remains
mounted; focus, draft and booking selection are not replaced.

This is **not physical iPhone browser-chrome verification**. Immediate theme switching while
still compact is also unverified: the
[top-sampling policy](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebCore/page/Page.cpp#L5799)
can suppress top resampling after interaction, and existing carrier renderers can retain cached
edge colors. The patch does not claim to close that conditional browser path. No visibility
workaround, forced scroll, theme-time remount or cache purge is used.

`mobileFoldLayout` adds these private carriers **after** CMS projection. Existing native IDs,
refs, controls and owner element order remain intact. The header's existing prefix before the
hero stays in order inside its private carrier. `snapshotNative` removes both carriers before
recording identities/baselines, and `canvasBehavior` provides equivalent temporary geometry in
the editing frame. The carriers are not a new saved CMS content model. App viewport painting now
selects the actual visual panel rather than assuming the surface's first child paints a color.

The editor's ID-based styles and the captured published presentation are the compatibility
contract exercised here. An additional owner rule changes the panel background, applies
`translateX(2px)` and `contain: layout style`; those values survive public rendering, capture and
the actual iframe canvas, with the header at zero and the visible panel bottom at 112px. Parsing
the earlier read-only production revision 57 found no mobile direct-child/sibling rules in the
home/booking pages across either language or theme; the only such rules targeted admin navigation.
Arbitrary raw CSS that depends on runtime parent/child ancestry is not made wrapper-transparent;
this patch adds no general selector rewriting or visibility override mechanism.

## Execution receipts

All commands ran in the isolated `fix/booking-first-frame` worktree, browser port offset 500.
No production actions, customer review submissions, emails, push or deployment were performed.

- `/tmp/mobile-native-product-edges`: real product implementation, 343/343 rendered frames with
  both header displacement and bottom/body error exactly zero, including first movement from
  hero zero, four reversals and reviews arriving during the gesture. Instrumentation adds colored
  paint markers only; it does not change the production positioning behavior.
- Root's independent frozen-source experiment: `/tmp/mobile-native-fold-clip-probe`, 351/351
  correct top/bottom frames and 0/336 shifted control frames. This is an independent experiment,
  not a substituted product execution receipt.
- `/tmp/mobile-native-geometry-initial`: 15 passing booking, keyboard and document-color cases
  across Chromium, Firefox and WebKit. Six sampler cases initially failed solely because the
  test expected JavaScript negative zero while DOM geometry reported zero.
- `/tmp/mobile-native-sampler-second`: the six corrected sampler cases pass in all three engines.
  They include home theme changes before/after scrolling, ordinary mouse/keyboard theme activation,
  booking/back navigation, privacy, modal state, owner theme colors and normal-motion navigation.
- `/tmp/mobile-native-canvas-final`: both Chromium/WebKit capture/canvas cases pass, including
  unchanged panel/native descendant IDs, owner styles, markup validation and disposal.
- `/tmp/mobile-native-paint-final`: all nine final product paint cases pass: source/stored,
  normal/reduced motion, initial hero movement and repeated reversals, asynchronous reviews,
  plus the control-region case with emulated DPR 3. There are no experiment positioning injections.
- Final typecheck, scoped ESLint and three focused unit files / nine tests pass. Diff-check passes.
- Build succeeded into `/tmp/mobile-native-build` before the final canvas pending-frame cleanup;
  the final source typecheck passes. The coordinator owns the integrated final build/full suite.
  No generated production artifact was committed.

The keyboard tests model delayed `innerHeight`/visualViewport size and offset events separately
from CSS viewport layout. They preserve the input, header position and compact bottom through
opening, closing and orientation-size changes; they do not open a real iOS keyboard. Chromium
screencast comparisons cover native touch paint, including emulated DPR 3, but the recorder's
output dimensions are not evidence of a physical DPR 3 iPhone display.
