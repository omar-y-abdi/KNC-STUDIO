import { describe, it, expect } from 'vitest'
import { mockServicesAdapter } from '../../src/booking/adapters/mockServices'
import { asBarberId } from '../../src/booking/domain'

describe('mockServicesAdapter', () => {
  it('returns no invented catalog for any barber', async () => {
    const a = await mockServicesAdapter.listForBarber(asBarberId('hassan'))
    const b = await mockServicesAdapter.listForBarber(asBarberId('victor'))
    expect(a).toEqual([])
    expect(b).toEqual([])
  })
})
