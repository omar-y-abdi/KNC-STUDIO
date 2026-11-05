import { lazy } from 'preact/compat'

const loadMyBookingsDialog = () => import('./MyBookingsDialog')

export const LazyMyBookingsDialog = lazy(() =>
  loadMyBookingsDialog().then((module) => ({ default: module.MyBookingsDialog })),
)

export function preloadMyBookingsDialog(): void {
  void loadMyBookingsDialog().catch(() => undefined)
}
