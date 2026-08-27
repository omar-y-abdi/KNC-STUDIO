import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUSINESS,
  buildBusinessStructuredData,
  resolveBusinessSettings,
} from '../../src/site/business'

describe('business structured data', () => {
  it('ships fully rendered fallback metadata without leaking CMS template tokens', () => {
    expect(resolveBusinessSettings(new Map())).toEqual(DEFAULT_BUSINESS)
    expect(JSON.stringify(DEFAULT_BUSINESS.seo)).not.toMatch(/\{(?:business_name|city)\}/)
  })

  it('derives truthful staff, prices, and merged opening intervals from active facts', () => {
    const data = buildBusinessStructuredData(
      DEFAULT_BUSINESS,
      {
        barbers: [
          { id: 'ada', name: 'Ada' },
          { id: 'bo', name: 'Bo' },
        ],
        services: [
          { id: 'one', barberId: 'ada', price: 300 },
          { id: 'two', barberId: 'bo', price: 450 },
        ],
        schedules: [
          { barberId: 'ada', weekday: 1, startMin: 540, endMin: 720 },
          { barberId: 'bo', weekday: 1, startMin: 660, endMin: 1080 },
          { barberId: 'ada', weekday: 2, startMin: 600, endMin: 900 },
          { barberId: 'missing', weekday: 3, startMin: 0, endMin: 1440 },
        ],
      },
      'https://example.com/',
    )

    expect(data.priceRange).toBe('300–450 kr')
    expect(data.employee).toEqual([
      { '@type': 'Person', name: 'Ada' },
      { '@type': 'Person', name: 'Bo' },
    ])
    expect(data.openingHoursSpecification).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday'],
        opens: '09:00',
        closes: '18:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Tuesday'],
        opens: '10:00',
        closes: '15:00',
      },
    ])
  })

  it('omits unsupported dynamic claims instead of inventing defaults', () => {
    const data = buildBusinessStructuredData(
      DEFAULT_BUSINESS,
      {
        barbers: [],
        services: [],
        schedules: [],
      },
      'https://example.com',
    )

    expect(data).not.toHaveProperty('employee')
    expect(data).not.toHaveProperty('priceRange')
    expect(data).not.toHaveProperty('openingHoursSpecification')
  })

  it('interpolates normal name and city edits into default SEO templates', () => {
    const business = resolveBusinessSettings(
      new Map([
        ['business_name', 'Changed Studio'],
        ['business_city', 'Malmö'],
      ]),
    )
    expect(business.seo.sv.title).toContain('Changed Studio')
    expect(business.seo.sv.description).toContain('Malmö')
    expect(business.seo.sv.description).not.toContain('{business_name}')
  })

  it('honours deliberate contact removal and omits empty structured-data properties', () => {
    const business = resolveBusinessSettings(
      new Map([
        ['business_phone_display', ''],
        ['business_phone_tel', ''],
        ['business_maps_href', ''],
      ]),
    )
    const data = buildBusinessStructuredData(
      business,
      { barbers: [], services: [], schedules: [] },
      'https://example.com',
    )
    expect(business.phoneDisplay).toBe('')
    expect(business.mapsHref).toBe('')
    expect(data).not.toHaveProperty('telephone')
    expect(data).not.toHaveProperty('hasMap')
  })
})
