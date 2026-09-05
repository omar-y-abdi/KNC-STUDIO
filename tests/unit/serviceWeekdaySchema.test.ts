import { describe, expect, it } from 'vitest'
import { serviceRow } from '../../src/admin/adminSchemas'
import { publicServiceRow } from '../../src/backend/rpcSchemas'

const service = {
  id: '11111111-1111-4111-8111-111111111111',
  barber_id: 'hassan',
  name: 'Klippning',
  price: 350,
  duration_min: 45,
  active: true,
  sort_order: 1,
  available_weekdays: [0, 1, 2, 3, 4, 5, 6],
}

describe('service weekday wire contracts', () => {
  it('accepts only a canonical sorted weekday set', () => {
    expect(serviceRow.safeParse(service).success).toBe(true)
    expect(publicServiceRow.safeParse(service).success).toBe(true)
  })

  it('rejects duplicate or unsorted weekdays before adapters use them', () => {
    const duplicate = { ...service, available_weekdays: [1, 1, 2, 3, 4, 5, 6] }
    const unsorted = { ...service, available_weekdays: [1, 0] }

    expect(serviceRow.safeParse(duplicate).success).toBe(false)
    expect(publicServiceRow.safeParse(duplicate).success).toBe(false)
    expect(serviceRow.safeParse(unsorted).success).toBe(false)
    expect(publicServiceRow.safeParse(unsorted).success).toBe(false)
  })

  it('rejects fractional or out-of-range service durations and positions', () => {
    for (const duration_min of [4.1, 4, 601, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(serviceRow.safeParse({ ...service, duration_min }).success).toBe(false)
      expect(publicServiceRow.safeParse({ ...service, duration_min }).success).toBe(false)
    }

    for (const sort_order of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(serviceRow.safeParse({ ...service, sort_order }).success).toBe(false)
      expect(publicServiceRow.safeParse({ ...service, sort_order }).success).toBe(false)
    }
  })
})
