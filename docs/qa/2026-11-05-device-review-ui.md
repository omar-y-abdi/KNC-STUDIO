# Device booking access for reviews

Base: `eb8b6f2`. This replaces the email-first review banner from the earlier mobile work.
A customer who can see their own finished booking through the existing HttpOnly device
receipt must be able to review that booking without an additional email-verification step.
The server remains authoritative for booking scope, matching phone, completion, and whether
that booking already has a review.

## UI changes

- Remove the review form's email-verification button and helper in both languages.
- Restore the straightforward phone instruction: use the number from the booking; the server
  supplies the displayed name. Scope-denial copy points to the phone and Mina bokningar rather
  than claiming email verification is required or that no booking exists globally.
- Remove the review-only App/Desktop callback and the App state that requested forced lookup.
  The ordinary My Bookings dialog, device listing, email links, and no-device recovery remain.
- Remove the now-unreferenced `verifyEmail` prop and forced-lookup branch in MyBookingsDialog.
  With no caller setting that prop, this preserves the existing default behavior: an access
  error opens lookup, an explicit token loads its bookings, and otherwise cookie restoration
  runs. Port/token/error changes still start a fresh dialog session and invalidate old work.
- Preserve the review heading and all existing editable field identities. No storage mechanism,
  authorization claim in browser state, new request field, or extra customer step is introduced.

The backend implementation is a coordinated change in `codex/device-review-access`. The browser
contract stays `review` with phone/rating/text/Turnstile, existing same-origin credentials, and
existing result/error shapes. This UI change alone does not establish server authorization.

## Baseline restoration

Commit `111c2c8` changed 36 stored-page screenshots while adding the removed review banner.
The 32 review-region files are restored exactly from `111c2c8^`: 16 macOS and 16 Linux images
covering desktop widths 800/1280 and mobile steps 3/4. The four Linux dark-mobile step 1/2
changes remain because they cover unrelated native-carrier header antialiasing. No screenshots
were regenerated or visually approved locally; GitHub execution and the user's manual review
remain required.

## Browser and unit coverage prepared for GitHub Actions

The existing `review-recovery.spec.mjs` now covers mobile/desktop in Swedish/English. A synthetic
HttpOnly device receipt lists the finished booking and submits its review without a verified
email session or request. A wrong phone and a different booking receipt are rejected without
losing the draft. The authored heading survives CMS projection. After removal of the device
receipt, the normal My Bookings email-recovery flow remains available.

This browser fixture reads the browser's URL-filtered cookie store because route interception
can precede Cookie attachment. It is UI coverage, not real Worker/Edge/SQL authorization proof.
The coordinated backend task owns that end-to-end coverage. The existing review adapter unit
also asserts submission without an explicit access token through the existing gateway.

No local tests, typecheck, formatter, build, install, browser, or Docker execution was performed.
Only static inspection and edits are authorized; all executable verification belongs to GitHub
Actions. No push, deployment, production mutation, or email was performed.

UI implementation commit: `418eb8379b0f219144b1cd957d5220ed02055aba`. The separate
`fix(mybookings): remove unused forced email lookup` follow-up removes the orphaned dialog
path described above; its exact SHA is supplied with the handoff. No additional executable
verification ran for that follow-up.

## Pending MobileSite edit owned by the hero integration

`MobileSite.tsx` is deliberately untouched while the hero author owns it. Once that work is
frozen, remove exactly these two lines in `modules/public-web/src/app/MobileSite.tsx`:

```diff
-  readonly onVerifyBooking?: () => void
```

```diff
-            {...(props.onVerifyBooking ? { onVerifyBooking: props.onVerifyBooking } : {})}
```

The App no longer supplies this callback and AboutSection no longer renders it. Removing these
last two lines completes the obsolete prop cleanup without modifying the hero layout.
