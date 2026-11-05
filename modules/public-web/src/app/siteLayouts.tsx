import { lazy } from 'preact/compat'

const loadMobile = () => import('./MobileSite').then((module) => ({ default: module.MobileSite }))
const loadDesktop = () =>
  import('./DesktopSite').then((module) => ({ default: module.DesktopSite }))

// Each layout includes its complete renderer before it becomes interactive. In particular,
// mobile glyph data cannot arrive halfway through the customer's first scroll gesture.
export const MobileSite = lazy(loadMobile)
export const DesktopSite = lazy(loadDesktop)

export async function preloadSiteLayout(mobile: boolean): Promise<void> {
  await (mobile ? loadMobile() : loadDesktop())
}
