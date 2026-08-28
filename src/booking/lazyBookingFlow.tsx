import { lazy } from 'preact/compat'

const loadBookingFlow = () => import('./BookingFlow')

export const LazyBookingFlow = lazy(() =>
  loadBookingFlow().then((module) => ({ default: module.BookingFlow })),
)

export function preloadBookingFlow(): void {
  void loadBookingFlow().catch(() => undefined)
}
