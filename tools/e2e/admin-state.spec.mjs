import { test } from './fixtures.mjs'
import {
  verifyNavigation,
  verifyDelayedRestore,
  verifyAdminSession,
  verifyMutationReentry,
  verifyDeliveryStatus,
  verifySettingsCancellation,
  verifyContactOwnership,
  verifyDelayedCatalog,
  verifyBookingTerms,
  verifyCalendarSync,
  verifyCustomerEmail,
} from './admin-checks.mjs'
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 10000 })
const cases = [
  ['navigation', verifyNavigation],
  ['delayed restore', verifyDelayedRestore],
  ...[
    'focus',
    'poll',
    'auth-event',
    'slow-signout',
    'late-profile',
    'late-password',
    'password-completes',
    'late-settings-password',
    'queued-write',
    'notification-gap',
    'late-reset-logout',
    'network',
  ].map((scenario) => ['session ' + scenario, (page) => verifyAdminSession(page, scenario)]),
  ...['services', 'profile', 'bookings'].flatMap((kind) => [
    ['mutation ' + kind, (page) => verifyMutationReentry(page, kind)],
    ['remount ' + kind, (page) => verifyMutationReentry(page, kind, 'remount')],
    ['target ' + kind, (page) => verifyMutationReentry(page, kind, 'target', true)],
  ]),
  ['delivery status', verifyDeliveryStatus],
  ...['owner', 'barber', 'load-failure', 'revisit-during-save'].map((scenario) => [
    'settings cancellation ' + scenario,
    (page) => verifySettingsCancellation(page, scenario),
  ]),
  ...['booking', 'review'].map((kind) => [
    'contact ownership ' + kind,
    (page) => verifyContactOwnership(page, kind),
  ]),
  ...[false, true].map((embedded) => [
    'delayed catalog ' + embedded,
    (page) => verifyDelayedCatalog(page, embedded),
  ]),
  ...['sv', 'en'].map((lang) => [
    'booking terms ' + lang,
    (page) => verifyBookingTerms(page, lang),
  ]),
  ['calendar sync', verifyCalendarSync],
  ['customer email', verifyCustomerEmail],
]
for (const [name, verify] of cases)
  test(name, async ({ page }) => {
    page.setDefaultTimeout(10000)
    await verify(page)
  })
