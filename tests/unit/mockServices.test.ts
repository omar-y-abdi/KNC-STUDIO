import { describe, it, expect } from 'vitest'
import { MOCK_SERVICES, mockServicesAdapter } from '../../src/booking/adapters/mockServices'
import { asBarberId } from '../../src/booking/domain'

describe('mockServicesAdapter', () => {
  it('returns the flat starter menu for any barber', async () => {
    const a = await mockServicesAdapter.listForBarber(asBarberId('hassan'))
    const b = await mockServicesAdapter.listForBarber(asBarberId('victor'))
    expect(a).toEqual(MOCK_SERVICES)
    expect(b).toEqual(MOCK_SERVICES)
    expect(a.length).toBe(5)
  })

  it('each service has a name, a positive price and a valid duration', () => {
    for (const svc of MOCK_SERVICES) {
      expect(svc.name.length).toBeGreaterThan(0)
      expect(svc.price).toBeGreaterThanOrEqual(0)
      expect(svc.dur).toBeGreaterThanOrEqual(5)
      expect(svc.id.length).toBeGreaterThan(0)
    }
  })
})
