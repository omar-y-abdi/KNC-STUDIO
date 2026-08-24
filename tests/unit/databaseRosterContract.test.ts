import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('database-owned public catalog', () => {
  it('never paints or restores named barbers from frontend constants', () => {
    const rosterHook = readFileSync('src/booking/useRoster.ts', 'utf8')
    const servicesHook = readFileSync('src/booking/useServices.ts', 'utf8')
    const sourceRoster = readFileSync('src/booking/barbers.ts', 'utf8')
    const mockRoster = readFileSync('src/booking/adapters/mockBarbers.ts', 'utf8')
    const mockServices = readFileSync('src/booking/adapters/mockServices.ts', 'utf8')

    expect(rosterHook).not.toContain('CONSTANT_ROSTER')
    expect(servicesHook).not.toContain('MOCK_SERVICES')
    expect(`${sourceRoster}\n${mockRoster}`).not.toMatch(/Hassan|Victor|Salman|freebandzcuts/)
    expect(mockServices).not.toMatch(/Hårklippning|Skäggklippning|Studentklippning/)
  })

  it('preloads and caches live catalog reads instead of fetching after booking opens', () => {
    const app = readFileSync('src/app/App.tsx', 'utf8')
    const rosterIndex = readFileSync('src/booking/adapters/barbersIndex.ts', 'utf8')
    const serviceIndex = readFileSync('src/booking/adapters/servicesIndex.ts', 'utf8')

    expect(app).toContain('preloadBookingCatalog')
    expect(rosterIndex).toContain('cachedBookingCatalog')
    expect(serviceIndex).toContain('cachedBookingCatalog')
  })
})
