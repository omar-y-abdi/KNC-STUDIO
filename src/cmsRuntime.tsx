import { render } from 'preact'
import { AboutSection } from './about/AboutSection'
import { BookingFlow } from './booking/BookingFlow'
import { MyBookingsDialog } from './mybookings/MyBookingsDialog'
import type { Lang } from './i18n'

type Mode = 'light' | 'dark'

export function mountCmsRuntime(root: HTMLElement): void {
  const lang: Lang = document.documentElement.lang === 'en' ? 'en' : 'sv'
  const about = root.querySelector<HTMLElement>('#knc-about-runtime')
  const booking = root.querySelector<HTMLElement>('#knc-booking-runtime')
  const myBookings = root.querySelector<HTMLElement>('#knc-my-bookings-runtime')
  // Rendering into the same containers again updates the islands in place, keeping their state.
  const renderIslands = (mode: Mode): void => {
    if (about) render(<AboutSection mode={mode} lang={lang} />, about)
    if (booking) render(<BookingFlow mode={mode} defaultLang={lang} />, booking)
    if (myBookings)
      render(
        <MyBookingsDialog mode={mode} lang={lang} onClose={() => window.location.assign('/')} />,
        myBookings,
      )
  }
  const requested = root.dataset['cmsMode']
  if (requested !== 'auto') {
    renderIslands(requested === 'dark' ? 'dark' : 'light')
    return
  }
  // `auto` follows the visitor's OS scheme, as the page sheets do, also after mount.
  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  const followOs = (): void => renderIslands(dark.matches ? 'dark' : 'light')
  followOs()
  dark.addEventListener('change', followOs)
}
