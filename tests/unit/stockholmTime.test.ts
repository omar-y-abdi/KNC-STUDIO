// The salon-timezone instant builder must map a Europe/Stockholm wall-clock to the correct UTC
// instant on BOTH sides of DST, and must do so independently of the process timezone (proving a
// non-Stockholm visitor's browser produces the right stored instant). Arithmetic cross-checked
// against Postgres `(timestamp 'YYYY-MM-DD 13:30' at time zone 'Europe/Stockholm') at time zone 'UTC'`.

import { describe, expect, it } from 'vitest'
import {
  localWallClockToStockholmIso,
  stockholmInstant,
  stockholmWallClockDate,
} from '../../src/booking/stockholmTime'

describe('stockholmInstant — DST-correct wall-clock → UTC', () => {
  it('CET (winter, UTC+1): 2040-03-14 13:30 Stockholm = 12:30:00Z', () => {
    expect(stockholmInstant(2040, 3, 14, 13, 30).toISOString()).toBe('2040-03-14T12:30:00.000Z')
  })

  it('CEST (summer, UTC+2): 2040-07-15 13:30 Stockholm = 11:30:00Z', () => {
    expect(stockholmInstant(2040, 7, 15, 13, 30).toISOString()).toBe('2040-07-15T11:30:00.000Z')
  })

  it('the day AFTER the spring-forward switch is already CEST (2040-03-25 09:00 = 07:00Z)', () => {
    // Sweden switches on the last Sunday of March (2040-03-25); 09:00 that day is post-switch → +2h.
    expect(stockholmInstant(2040, 3, 25, 9, 0).toISOString()).toBe('2040-03-25T07:00:00.000Z')
  })
})

describe('stockholmWallClockDate — instant → Stockholm wall-clock components (the inverse)', () => {
  it('CET (winter): 12:30:00Z reads back as 13:30 local components', () => {
    const wall = stockholmWallClockDate(new Date('2040-03-14T12:30:00.000Z'))
    expect([wall.getHours(), wall.getMinutes(), wall.getDate()]).toEqual([13, 30, 14])
  })

  it('CEST (summer): 11:30:00Z reads back as 13:30 local components', () => {
    const wall = stockholmWallClockDate(new Date('2040-07-15T11:30:00.000Z'))
    expect([wall.getHours(), wall.getMinutes(), wall.getDate()]).toEqual([13, 30, 15])
  })

  it('round-trips with stockholmInstant for a grid slot', () => {
    const instant = stockholmInstant(2040, 3, 25, 9, 0)
    const wall = stockholmWallClockDate(instant)
    expect([wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), wall.getHours()]).toEqual([
      2040, 3, 25, 9,
    ])
  })
})

describe('localWallClockToStockholmIso — reinterprets a Date built from local components', () => {
  it('treats the Date’s wall-clock numbers as Stockholm regardless of how the Date was made', () => {
    // A Date constructed from explicit local components: its getHours() reads back 13 in ANY tz the
    // process runs in, so re-anchoring to Stockholm yields the winter instant deterministically.
    const local = new Date(2040, 2 /* March */, 14, 13, 30)
    expect(localWallClockToStockholmIso(local)).toBe('2040-03-14T12:30:00.000Z')
  })
})
