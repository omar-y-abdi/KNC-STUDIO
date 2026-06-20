import { describe, it, expect } from 'vitest'
import { pricing } from '../../src/booking/pricing'
import { bookingStrings } from '../../src/i18n/index'

const t = bookingStrings('sv')
// June 2026: 17=Wed, 20=Sat, 15=Mon, 21=Sun (19 = the mock's "today", a Friday).
const pricesOn = (day: number): number[] =>
  pricing(new Date(2026, 5, day), t).flatMap((g) => g.items.map((i) => i.price))

describe('pricing by weekday (verbatim numbers from the source)', () => {
  it('Wednesday: full menu + student discount + kids', () => {
    expect(pricesOn(17)).toEqual(expect.arrayContaining([450, 350, 200, 300, 289]))
  })
  it('Saturday: full menu + kids, no student discount', () => {
    const p = pricesOn(20)
    expect(p).toEqual(expect.arrayContaining([450, 350, 200, 289]))
    expect(p).not.toContain(300)
  })
  it('Monday: reduced menu + kids', () => {
    expect(pricesOn(15)).toEqual(expect.arrayContaining([400, 320, 289]))
  })
  it('Sunday (closed): only the kids group', () => {
    const groups = pricing(new Date(2026, 5, 21), t)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items[0]?.price).toBe(289)
  })
})
