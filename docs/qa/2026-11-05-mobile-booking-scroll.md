# Reversible mobile booking scroll

Follow-up to `68bd7fb`. The booking view previously forced a 112px panel and omitted its hero
spacer, so returning the inner scroller to zero could never restore the hero. Booking now uses
the same fold geometry as About. Entering booking starts at its content; scrolling back to the
hero leaves the booking component and its selection mounted. Pressing Boka tid again scrolls to
that same booking. The existing back arrow still returns to Home.

The spacer occupies the same source-child index previously reserved by its conditional null;
existing native CMS identities are preserved. The editing canvas now handles the booking fold
as well as Home and initializes a captured booking at its content once its mobile root is visible.

The existing lifecycle unit needed repair for the CSS-viewport/ResizeObserver implementation in
the preceding checkpoint. It now models the measured height plus privacy reservation, observer
delivery, unchanged-state identity, keyboard-independent height, real CSS resizing and disposal.
Scroll coalescing is retained.

## Verification

- Old source: both source/stored regressions fail at scroll zero, where the booking panel stays
  112px instead of restoring 844px. Receipt: `/tmp/mobile-fold-after-paint-red`.
- New browser regression checks entry at offset 732, theme changes, selected barber state and
  DOM identity, scrolling up, repeated Boka tid, the existing back arrow, and direct booking routes.
- Existing viewport/keyboard checks retained. The theme test uses an actual pointer hit on the
  visible compact control, then native focus and Enter on the back arrow. The old locator click
  explicitly scrolled the already-visible sticky descendant to its normal-flow position before
  mousedown; trace snapshots identify that test-driver scroll. Pointer input and keyboard focus
  preserve the booking offset in Chromium, Firefox and WebKit.
- Captured markup is checked by the real CMS validator. A real iframe using `canvasBehavior`
  verifies initial booking position, reversible folding, and style/listener disposal.
- Typecheck and focused lifecycle/mobileFold tests pass. The full unit run during this work
  passed 2,322 tests in 175 files (`/tmp/mobile-fold-unit-full.log`).

Final browser results: 36 public cases passed across Chromium/Firefox/WebKit in
`/tmp/mobile-booking-scroll-final/test-results/results.json`; both canvas capture/validator cases
passed in `/tmp/mobile-booking-canvas-rendered/test-results/results.json`. Focused ESLint and
format checks also passed. No production data, deployment, migration or messages were changed.

## Separate outstanding report

The reported choppy hero/About motion remains open. A compositor-transform prototype improved
steady scrolling but still failed strict painted-frame tests when content resized during touch
scrolling. It is not included in this change. The experiment and failing assertions are preserved
outside the checkout at `/tmp/mobile-scroll-smoothing-prototype`; retaining the existing scheduler
here must not be described as fixing that report. Physical iPhone Safari was not tested.
