import { describe, expect, it } from 'vitest'
import { asBarberId } from '../../src/booking/domain'
import {
  servicesForBookingDate,
  type BookingCatalog,
} from '../../src/booking/adapters/supabaseBookingCatalog'

const barberId = asBarberId('hassan')
const service = { id: 'sunday-service', name: 'Sunday service', price: 350, dur: 45 }
const catalog: BookingCatalog = {
  barbers: [],
  servicesByBarber: new Map([[barberId, [service]]]),
  weekdaysByServiceId: new Map([[service.id, [0]]]),
}

describe('cached service menu', () => {
  it('keeps a configured Sunday service while excluding it on other weekdays', () => {
    const sunday = '2040-03-18'
    expect(new Date(2040, 2, 18).getDay()).toBe(0)

    expect(servicesForBookingDate(catalog, barberId, sunday)).toEqual([service])
    expect(servicesForBookingDate(catalog, barberId, '2040-03-19')).toEqual([])
  })
})
