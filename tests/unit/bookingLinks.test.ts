import { describe, it, expect } from 'vitest'
import { buildLinks } from '../../src/booking/adapters/localCalendar'
import { BARBERS } from '../../src/booking/barbers'
import type { Barber, Booking, ServiceItem } from '../../src/booking/domain'
import { asBarberId } from '../../src/booking/domain'

// buildLinks is the pure, client-side calendar/map link builder used by BOTH the mock and (on a
// successful submit) the Supabase adapter — so the confirmation modal's .ics / Google Cal / maps
// links are identical regardless of backend. The links don't ride on the create_booking RPC, so
// they're verified here at the unit level (the integration suite covers the RPC contract instead).

const HASSAN: Barber = BARBERS[0] ?? {
  id: asBarberId('hassan'),
  name: 'Hassan',
  ig: 'freebandzcuts',
}
const HAIRCUT: ServiceItem = { id: 'h', name: 'Hårklippning', price: 350, dur: 45 }

function booking(): Booking {
  const start = new Date(2040, 2, 14, 13, 30)
  const end = new Date(start.getTime() + HAIRCUT.dur * 60000)
  return {
    barber: HASSAN,
    service: HAIRCUT,
    start,
    end,
    customerName: 'Link Tester',
    phone: '0701234567',
    email: 'link@example.com',
    lang: 'sv',
    turnstileToken: '',
  }
}

describe('buildLinks', () => {
  // `now` is injected so the UID (and thus the whole href) is deterministic.
  const NOW = new Date(2040, 2, 1, 9, 0)

  it('builds an .ics data URL, a Google Calendar template URL and a maps URL', () => {
    const links = buildLinks(booking(), NOW)
    expect(links.icsHref.startsWith('data:text/calendar')).toBe(true)
    expect(links.gcalHref.startsWith('https://calendar.google.com/')).toBe(true)
    expect(links.mapsHref.length).toBeGreaterThan(0)
  })

  it('encodes the event into both the ICS payload and the Google Calendar template', () => {
    const links = buildLinks(booking(), NOW)
    // The Google template carries the render action + the encoded barber/service title, and pins
    // the floating wall-clock to the salon timezone (without ctz Google would use the user's).
    expect(links.gcalHref).toContain('action=TEMPLATE')
    expect(links.gcalHref).toContain('ctz=Europe%2FStockholm')
    expect(decodeURIComponent(links.gcalHref)).toContain('Hårklippning')
    // The .ics payload is a real VCALENDAR with the event summary.
    const ics = decodeURIComponent(links.icsHref.replace('data:text/calendar;charset=utf-8,', ''))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('Hårklippning')
  })
})
