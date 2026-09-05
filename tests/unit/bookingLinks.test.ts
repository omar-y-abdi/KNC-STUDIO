import { describe, it, expect } from 'vitest'
import { buildLinks } from '../../src/booking/adapters/localCalendar'
import type { Barber, Booking, ServiceItem } from '../../src/booking/domain'
import { asBarberId } from '../../src/booking/domain'
import type { BusinessSettings } from '../../src/site/siteChrome'

// buildLinks is the pure, client-side calendar/map link builder used by BOTH the mock and (on a
// successful submit) the Supabase adapter — so the confirmation modal's .ics / Google Cal / maps
// links are identical regardless of backend. The links don't ride on the create_booking RPC, so
// they're verified here at the unit level (the integration suite covers the RPC contract instead).

const HASSAN: Barber = {
  id: asBarberId('hassan'),
  name: 'Hassan',
  ig: 'freebandzcuts',
}
const HAIRCUT: ServiceItem = { id: 'h', name: 'Hårklippning', price: 350, dur: 45 }
const BUSINESS: BusinessSettings = {
  name: 'Northside Barbers',
  email: 'hello@northside.example',
  phoneDisplay: '08-123 45 67',
  phoneTel: '+4681234567',
  street: 'Kungsgatan 1',
  postalCode: '111 43',
  city: 'Stockholm',
  mapsHref: 'https://maps.example.com/northside',
  cancellationPolicyHours: 24,
  seo: {
    sv: { title: 'Northside', description: 'Svensk SEO' },
    en: { title: 'Northside', description: 'English SEO' },
  },
}

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
    const links = buildLinks(booking(), NOW, BUSINESS)
    expect(links.icsHref.startsWith('data:text/calendar')).toBe(true)
    expect(links.gcalHref.startsWith('https://calendar.google.com/')).toBe(true)
    expect(links.mapsHref).toBe(BUSINESS.mapsHref)
  })

  it('encodes the event into both the ICS payload and the Google Calendar template', () => {
    const links = buildLinks(booking(), NOW, BUSINESS)
    // The Google template carries the render action + the encoded barber/service title, and pins
    // the floating wall-clock to the salon timezone (without ctz Google would use the user's).
    expect(links.gcalHref).toContain('action=TEMPLATE')
    expect(links.gcalHref).toContain('ctz=Europe%2FStockholm')
    expect(decodeURIComponent(links.gcalHref)).toContain('Hårklippning')
    // The .ics payload is a real VCALENDAR with the event summary.
    const ics = decodeURIComponent(links.icsHref.replace('data:text/calendar;charset=utf-8,', ''))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('Northside Barbers')
    expect(ics).toContain('Kungsgatan 1')
    expect(ics).toContain('Hårklippning')
  })

  it('uses Stockholm UTC instants in ICS while keeping Google Calendar wall-clock time', () => {
    const start = new Date(2040, 6, 15, 13, 30)
    const summerBooking = {
      ...booking(),
      start,
      end: new Date(start.getTime() + HAIRCUT.dur * 60000),
    }

    const links = buildLinks(summerBooking, NOW, BUSINESS)
    const ics = decodeURIComponent(links.icsHref.replace('data:text/calendar;charset=utf-8,', ''))
    const google = decodeURIComponent(links.gcalHref)

    expect(ics).toContain('DTSTART:20400715T113000Z')
    expect(ics).toContain('DTEND:20400715T121500Z')
    expect(google).toContain('dates=20400715T133000/20400715T141500')
    expect(google).toContain('ctz=Europe/Stockholm')
  })
})
