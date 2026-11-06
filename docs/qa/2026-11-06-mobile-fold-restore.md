# Mobile fold restore

Batch B1 of the 2026-11-06 cleanup. Frontend and Studio canvas only: no Supabase migration,
customer-data change or Cloudflare binding change. Restored mechanism: `be2c0a4`.

## Restored

- Folding panel `position: sticky; top: 0; height: calc(100dvh - collapse px)`, one `collapse` state
  from `mobileFold(scrollTop, viewportHeight)`; hero centered in the shrinking panel, spacer keeping
  the document position (`MobileSite.tsx`). No transform or translate writes, no touch, wheel or
  non-passive listeners, no carriers, no priming; `mobileFoldLayout.tsx` deleted.
- "Boka tid" from the mounted hero: scroll jumps to the fold limit while the panel tweens to 112px
  over `height .66s cubic-bezier(.32,.72,0,1)` and the hero fades over `opacity .34s ease`; the
  tween ends on the panel's `height` transitionend or 700 ms later, then the scroll-driven height
  takes over and scrolling up restores the hero with the booking mounted. Reduced motion: no tween,
  no morph. Direct `/booking` URLs and CMS scenes mount folded; later navigation is native smooth.
- The hero-to-BNB morph accepted on 2026-11-05 is painted from the same `collapse`; during the
  entry tween it follows the panel's rendered height frame by frame.

## Kept

`mobileLayoutViewportHeight` with the root ResizeObserver and the relative panel header (`8b986f9`),
`paintViewport` sampling the panel, `monogramPaths.ts`, Safari corner colours, the booking flow,
gallery, cards and consent files, the image-load and font-ready remeasure signals of the morph.

## Withdrawn

Sticky carrier, translate writes and tween removal (`809160b`); instant booking entry (`5c6d9b8`);
carriers, priming and listeners (`b39a21b`); `data-knc-brand-part` markers (`bd65445`; desktop
logo markup is `be2c0a4` again); window-focus and dialog-close `/api/customer-bookings` re-lists;
the full-screen "Laddar bokningar …" surface (chunk lazy, awaited before the dialog opens; failed
import opens the dialog so its error and retry show). New: `overflow-anchor: none` on the scroll
root, because the entry tween shrinks the panel above a fixed scroll position.

## Not verified

No browser, unit or e2e run (typecheck, eslint, prettier only). Not checked on a physical iPhone:
Safari edge colours, the keyboard fold, the `809160b` WebKit sticky-colour cache claim (unverified
theory). Tapping the chevron or panning within the 660 ms entry tween ends the pin early and the
panel steps to the scroll-driven height before the reverse scroll grows it; not browser-verified.
