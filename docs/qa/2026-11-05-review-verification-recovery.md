# Review verification recovery (superseded checkpoint)

This document records the earlier email-first recovery implementation and its historical
verification. It is **not the current review-access requirement**. The user subsequently
required the same device booking access as Mina bokningar, without a separate email step.
See [Device review UI](2026-11-05-device-review-ui.md) for the replacement UI and verification
limits. The original observations and receipts below describe the earlier checkpoint only.

Base: `e484e7d`. A customer could see a finished appointment under Mina bokningar yet receive
text claiming that no completed booking existed when submitting a review. The public gateway
and review RPC at that checkpoint used `no_booking` both for missing verified email scope and for a scope without
an eligible booking. The old UI turned that deliberately ambiguous result into a false claim
about the existence of a booking and supplied no direct verification action.

## Authorization findings

Read-only production inspection at that checkpoint recorded the then-deployed function/SQL
policy. Listing accepted either verified email access or a device booking receipt. Reviewing
then required verified email scope, a matching phone, a confirmed appointment whose end time
had passed, and no prior review for that appointment. The Worker forwarded the allowed customer
cookies; the browser adapter used same-origin credentials. No credential-propagation defect
was found in that earlier path.

Seeing an appointment in the same browser establishes listing access, not which cookie supplied
it. The customer's exact Safari cookies were not observed. Private production receipts remain
outside the repository; tests use only synthetic identities. This change does not assert that
email verification alone guarantees review eligibility.

## Change

- Offer email verification at the beginning of the review form, using the existing secure
  customer-access flow. The action opens email lookup even when a receipt can already list
  appointments. Explicit verification starts a fresh dialog session; late receipt hydration
  cannot replace the requested lookup view.
- Keep the original review component mounted while the dialog is open. A customer can open the
  email link in another tab in the same browser context and return with the draft intact. The
  existing same-document link flow also preserves the draft.
- Explain verified email access in Swedish and English, and replace the categorical missing-
  booking message with instructions that remain true for missing, expired or different scope
  and for genuinely ineligible bookings.
- Keep existing CMS field identities. The new action is inside the existing form heading, and
  the browser regression edits that heading in the published fixture to prove the owner text
  and new action both survive projection.

There is no new localStorage/sessionStorage mechanism or privacy-policy change. A full reload
replaces the in-memory draft. The UI recommends verifying first, or opening the email link in
another tab if a draft already exists. No SQL, gateway authorization, challenge verification,
booking status, one-review-per-booking rule or migration was changed. This is a frontend rollout;
no CMS rewrite or database rollout is required for the recovery action.

## Verification and limits

- Before the change, the browser test reproduces the denial and fails because the verification
  action is missing: `/tmp/review-recovery-red-action/test-results/results.json`.
- Final browser run: **9 passed**, covering Chromium, Firefox and WebKit at mobile/desktop sizes,
  separate-tab and same-document link flows, authored stored heading text, late receipt-list
  delivery, retained phone/text/rating, wrong-customer and wrong-phone denials, and successful
  submission after matching verified access. Receipt:
  `/tmp/review-recovery-all-final/test-results/results.json`.
- The browser fixtures use actual synthetic HttpOnly cookies, Set-Cookie and shared browser
  cookie storage across tabs. The mock gateway reads the browser's URL-filtered cookie jar:
  [Playwright documents that route interception precedes network-stack cookie attachment](https://playwright.dev/docs/network).
  This is **not wire-level server-transport or production SQL execution proof**. The actual
  adapter's same-origin review credentials are separately asserted in
  `tests/unit/publicBookingActions.test.ts`; server authorization contracts remain unchanged.
- Typecheck and focused ESLint passed. The full unit run passed **2,322 tests in 175 files**
  before adding the explicit review-credentials parameter case; the final focused client and
  review-contract run passed **23 tests**, including that new case. Full-unit receipt:
  `/tmp/review-recovery-unit-full.log`.
- Database integration/pgTAP suites were not rerun locally against a shared stack. Existing
  server contract checks remain part of PR CI. No production review, verification email,
  database mutation or deployment was performed.

The separate choppy-scroll investigation remains open and is not included in this recovery.
