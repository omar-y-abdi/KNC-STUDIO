import { test } from './fixtures.mjs'
import {
  verifyPublicPage,
  verifyNormalMotionGalleryKeyboard,
  verifyStaticEndpoints,
} from './public-checks.mjs'
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
])
  test.describe('public ' + viewport.width, () => {
    test.use({ viewport, reducedMotion: 'reduce', hasTouch: true })
    test('booking, my bookings, gallery and discovery', async ({ page }) =>
      verifyPublicPage(page, viewport))
  })
test.describe('normal motion', () => {
  test.use({
    viewport: { width: 2400, height: 900 },
    reducedMotion: 'no-preference',
    hasTouch: true,
  })
  test('gallery keyboard and pointer controls', async ({ page }) =>
    verifyNormalMotionGalleryKeyboard(page))
})
test('static endpoints', async ({ page }) => verifyStaticEndpoints(page))
