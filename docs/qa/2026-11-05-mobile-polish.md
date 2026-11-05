# Mobile booking and About follow-up

## Scope and observed causes

This change addresses six reported mobile issues while retaining photo enlargement.

1. Gallery pointer selection must pause the current row and highlight the physical photo in place. Pointer-down now prevents native focus, independently of browser `:focus-visible` heuristics; keyboard focus retains its reveal behavior. Tests exercise mouse/touch at both clipped edges and the middle of both rows, plus native vertical touch scrolling.
2. Barber cards use a 32 px inter-card gap instead of 48 px and AutoScroll speed 0.25 instead of 0.18. The loop floor and CMS resize minimum follow the new geometry, including two-card layouts and shrinking from tablet to phone width.
3. Instagram/TikTok handles become safe profile links after the stored CMS presentation is projected. Existing owner text and captured identities remain intact; links in collapsed cards leave the tab order, and activating a link does not toggle the card.
4. A stored details snapshot omitted the conditional verification wrapper. The projection appended that new runtime child after Book, leaving an 85.8 px tail. New runtime siblings now precede their next surviving source sibling. Turnstile also releases its initial 65 px reservation after success/error: visible widgets keep their intrinsic height, while invisible widgets no longer leave an empty gap.
5. Device-receipt booking access previously supplied no verified profile, so profile-only form hydration stayed empty. The list RPC now supplies a separate, unverified contact hint from the latest exact-ID receipt-owned booking. Verified identity, review authorization and history access remain separate. Typed edits survive hydration; withdrawal, revocation and account-link changes clear stale hints. Confirmation uses the submitted booking snapshot rather than mutable next-booking fields.
6. Safari's edge sampler can reuse the previous color for a viewport-sized sticky hero before reading its changed background. The hero now stays in normal flow and translates during its fold; only the fully compact panel is pinned. The existing small controls header provides the live edge color. Shared canvas behavior follows the same geometry. Explicit theme selection also supplies one unconditional `theme-color` and synchronizes `color-scheme` metadata. OS-specific bootstrap tags remain for first paint.

The Safari mechanism is grounded in WebKit commit `c5bdf94bf481c781aba9c82ca51eb3045a850949`: [viewport size classification](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebCore/page/LocalFrameView.cpp#L2406), [cached color preference](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebCore/page/LocalFrameView.cpp#L2711), and [last visible edge retention](https://github.com/WebKit/WebKit/blob/c5bdf94bf481c781aba9c82ca51eb3045a850949/Source/WebCore/page/Page.cpp#L5849). The regression models that classification against actual rendered source/stored geometry, including custom CMS colors, privacy controls, modal close, theme changes and navigation.

Opening booking now changes the header height immediately: the former 0.66-second height tween made the short sticky header temporarily viewport-sized and reproduced the stale-color condition for four sampled frames. Border-radius, hero-opacity and brand transitions remain. Scroll folding retains its viewport coordinates and spacer geometry.

## Integration and rollout

PR #172 had been merged into the staff-invitation branch after #171 was already merged into main. During this investigation, main and production again contained the pre-fix gallery focus reset. This branch starts from main and includes the earlier gallery fix, so the combined PR delivers it through the production branch rather than relying on a separate deployment.

Apply `20261105074335_device_booking_contact_prefill.sql` before deploying the frontend to enable receipt-based contact hints. Existing gateway code forwards the additive response field. The frontend remains compatible with a gateway that omits it. No production schema or deployment was changed for this PR.

## Verification and limits

- Full unit suite: 2,312 tests across 174 files, with existing timeout thresholds unchanged. The first concurrent run timed out in two existing `cmsCorePages` cases; the isolated 28-case file and full suite with two workers passed.
- PostgreSQL: 67 existing authority assertions plus 13 receipt-contact assertions passed inside rollback transactions. The original local function and absence of fixture bookings were verified afterward.
- Browser coverage includes actual App/adapter/form flows in Chromium, Firefox and WebKit; delayed/revoked contact responses; confirmation snapshots; old CMS snapshots; theme changes and navigation; visible/invisible/failed/retried verification; small and short viewports; gallery pointer/keyboard/scroll behavior; social navigation; and carousel resize/loop boundaries.
- Consent regressions include withdrawal/re-enable, reads begun while storage is off, reads during pending server revocation and delayed verified-profile hydration. A device-specific epoch protects optional hints without cancelling verified identity or email-link access.
- TypeScript, ESLint, Prettier, production build and public bundle budget are required before handoff. The complete Worker → Edge → PostgreSQL customer flow has additional assertions in `customer.spec.mjs`; its execution belongs to the isolated CI customer stack.
- Physical iPhone Safari toolbar/notch tint, native pinch gestures and a physical iOS keyboard were not tested. Browser tests establish metadata, document colors, scrolling and geometry; they are not a claim about all native Safari chrome behavior.
