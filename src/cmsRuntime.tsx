import { render } from 'preact'
import { AboutSection } from './about/AboutSection'
import { BookingFlow } from './booking/BookingFlow'
import { MyBookingsDialog } from './mybookings/MyBookingsDialog'
import type { Lang } from './i18n'

type Mode = 'light' | 'dark'

export function mountCmsRuntime(root: HTMLElement): void {
  const lang: Lang = document.documentElement.lang === 'en' ? 'en' : 'sv'
  const requested = root.dataset['cmsMode']
  // `auto` follows the visitor's OS scheme, as the native app does (src/app/App.tsx).
  const mode: Mode =
    requested === 'dark' ||
    (requested === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light'
  const about = root.querySelector<HTMLElement>('#knc-about-runtime')
  if (about) render(<AboutSection mode={mode} lang={lang} />, about)
  const booking = root.querySelector<HTMLElement>('#knc-booking-runtime')
  if (booking) render(<BookingFlow mode={mode} defaultLang={lang} />, booking)
  const myBookings = root.querySelector<HTMLElement>('#knc-my-bookings-runtime')
  if (myBookings)
    render(
      <MyBookingsDialog mode={mode} lang={lang} onClose={() => window.location.assign('/')} />,
      myBookings,
    )
}
