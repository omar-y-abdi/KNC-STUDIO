import { describe, it, expect } from 'vitest'
import { buildDemoBooking } from '../../src/cancellation/demoBooking'

// "today" is injected, so these are fully deterministic (no clock read, no DOM).
// 2026-06-19 is a Friday; +2 lands on Sun 2026-06-21 (salon closed) → skips to Mon 2026-06-22.
const TODAY = new Date(2026, 5, 19)

describe('buildDemoBooking', () => {
  it('skips Sunday and lands on the next open day', () => {
    const b = buildDemoBooking(TODAY, 'sv', '0701234567')
    // Monday 2026-06-22.
    expect(b.start.getFullYear()).toBe(2026)
    expect(b.start.getMonth()).toBe(5)
    expect(b.start.getDate()).toBe(22)
    expect(b.start.getDay()).not.toBe(0)
  })

  it('uses a real barber, a SLOTS time and a weekday-appropriate service/price', () => {
    const b = buildDemoBooking(TODAY, 'sv', '0701234567')
    // Day-of-month 22 % 3 barbers = index 1 → Victor.
    expect(b.barber.name).toBe('Victor')
    // Mid-list slot → 13:30.
    expect(b.start.getHours()).toBe(13)
    expect(b.start.getMinutes()).toBe(30)
    // Monday menu's first item is the haircut + beard at 400 kr.
    expect(b.serviceName).toBe('Hårklippning + skägg')
    expect(b.price).toBe(400)
  })

  it('localizes the when-label and service name', () => {
    const sv = buildDemoBooking(TODAY, 'sv', '0701234567')
    const en = buildDemoBooking(TODAY, 'en', '0701234567')
    expect(sv.whenLabel).toContain('Måndag')
    expect(sv.whenLabel).toContain('13:30')
    expect(en.whenLabel).toContain('Monday')
    expect(en.serviceName).toBe('Haircut + beard')
  })

  it('echoes the contact, and produces a stable id', () => {
    const b = buildDemoBooking(TODAY, 'en', '0709999999')
    expect(b.contact).toBe('0709999999')
    expect(b.id).toBe('demo-2026-6-22')
  })
})
