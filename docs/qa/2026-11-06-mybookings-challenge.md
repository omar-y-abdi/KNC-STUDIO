# My Bookings challenge on first input

## Root cause

Opening "Mina bokningar" on desktop without a device receipt lands on the lookup step, which
mounted `<Turnstile action="customer_access">` at once. Cloudflare's `turnstile.render` runs the
challenge on render: a challenge iframe, about 1.5 s of challenge script, and GPU compositor tasks
of 210–270 ms back to back; every dropped frame in the owner's Chrome trace lies inside one of those
stalls. Each open created a new widget, and the script's `debugger` statement is the DevTools pause.

## Change

`challengeStarted` in `MyBookingsDialog.tsx` latches on the first non-empty email input (`onEmail`,
the only `setEmail` caller) and gates the Turnstile mount; the conditional child keeps its position,
so the CMS slot id `knc-my-bookings-0-i0-i1-i3-i3` and the button's id do not shift. The latch never
resets within a dialog session: "Använd en annan e-postadress" keeps the typed email and the existing
`turnstileNonce` bump mounts the widget again at once. `tools/e2e/my-bookings-challenge.spec.mjs`
pins: no render on open, none 300 ms later, one after the first keystroke, still one after a cleared
and refilled field, then one sent request.

## Not verified

No browser run (typecheck, eslint, prettier only). Pasting the email and clicking at once now waits
up to the challenge time with the send button disabled; before, the challenge had a head start from
open. The booking details dialog still mounts its widget on render, and the About review form once
About is active in the viewport.
