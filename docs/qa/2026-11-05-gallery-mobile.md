# Mobile gallery motion and selection

## Reproduction

Production was inspected at 390 × 844 in Chrome with touch emulation. In the salon gallery, a touch selected the correct physical photo but the focus handler reset the track from `translateX(-572.349px)` to zero. The selected photo moved from approximately 100 px to 672 px, outside the viewport. The salon and haircut galleries share `GalleryMarquee`; production had five distinct salon photos and one haircut photo, so the same reset was much less apparent in the latter.

Regression tests failed before the fix for a 101 px touch jump, movement below the gesture threshold, and 358 px of native horizontal scroll accumulated by keyboard focus. A delayed-image test also showed both rows moving before image delivery; the reverse row immediately wraps into lazy-loaded copies.

## Behavior

- Pointer focus leaves the tapped photo in place. Keyboard focus pauses and reveals the focused photo, incorporating any native scroll into the track offset.
- Movement begins only after a horizontal gesture exceeds the movement threshold. Vertical scrolling and sub-threshold motion never drag the row.
- Each visible row eagerly decodes its photos, including loop copies, before automatic motion starts. Rejected decodes do not prevent animation. Visibility, reduced-motion and unmount guards remain in force.

## Verification

- `npm test`: 2,306 tests passed across 173 files.
- TypeScript, changed-file ESLint, Prettier, production build and bundle budget passed.
- `cms-gallery-interaction.spec.mjs`: five cases in Chromium and WebKit, covering touch selection/deselection, cold images, gesture intent, keyboard navigation and failed images.
- Existing gallery container-resize test passed in Chromium and WebKit.
- `public-smoke.spec.mjs`: seven cases passed, including 390 px and 1280 px layouts, normal-motion gallery controls and carousel fallback.

The first broad browser run used the production-configured build rather than the isolated fixture build; the network guard blocked production requests. That run was stopped and repeated with `admin-harness.invalid` and separate artifact directories. No guard or assertion was weakened.

Physical iPhone/Android frame pacing was not measured. These checks establish the coordinate, gesture and image-readiness behavior in browser engines; they do not guarantee a particular frame rate on every device.
