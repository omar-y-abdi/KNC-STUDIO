import { lazy } from 'preact/compat'

// Each layout includes its complete renderer before it becomes interactive. In particular,
// mobile glyph data cannot arrive halfway through the customer's first scroll gesture.
export const MobileSite = lazy(() =>
  import('./MobileSite').then((module) => ({ default: module.MobileSite })),
)
export const DesktopSite = lazy(() =>
  import('./DesktopSite').then((module) => ({ default: module.DesktopSite })),
)
