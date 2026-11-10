import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUSINESS,
  buildBusinessStructuredData,
  resolveBusinessSettings,
} from '../../modules/public-web/src/site/business'

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
    expect(data.employee).toMatchObject([
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

  it('retains decimal service prices in the public price range', () => {
    const data = buildBusinessStructuredData(
      DEFAULT_BUSINESS,
      {
        barbers: [{ id: 'ada', name: 'Ada' }],
        services: [{ id: 'decimal', barberId: 'ada', price: 199.99 }],
        schedules: [],
      },
      'https://example.com',
    )

    expect(data.priceRange).toBe('199.99 kr')
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

  const telephone = (phoneTel: string): unknown =>
    buildBusinessStructuredData(
      { ...DEFAULT_BUSINESS, phoneTel },
      { barbers: [], services: [], schedules: [] },
      'https://example.com',
    )['telephone']

  it.each([
    ['0793043671', '+46793043671'],
    ['079-304 36 71', '+46793043671'],
    ['031 (12) 34.56', '+4631123456'],
    ['08 123 456 78', '+46812345678'],
  ])('writes the Swedish national number %s in international form', (stored, international) => {
    expect(telephone(stored)).toBe(international)
  })

  it.each([
    ['0046793043671', '+46793043671'],
    ['00 46 79 304 36 71', '+46793043671'],
    ['001 (212) 555-0100', '+12125550100'],
  ])('writes %s, behind the international prefix 00, with a plus', (stored, international) => {
    expect(telephone(stored)).toBe(international)
  })

  it.each([
    // Already international, written with a plus.
    '+46793043671',
    '+46 79 304 36 71',
    // Neither a national number with one trunk zero nor a number behind 00.
    '112',
    '793043671',
    '+1 (212) 555-0100',
    '00',
    '000123',
  ])('keeps the telephone %s as it is stored', (stored) => {
    expect(telephone(stored)).toBe(stored)
  })

  it('gives the default business an international telephone and claims no coordinates or profiles', () => {
    const data = buildBusinessStructuredData(
      DEFAULT_BUSINESS,
      { barbers: [], services: [], schedules: [] },
      'https://example.com',
    )
    expect(data['telephone']).toBe('+46793043671')
    expect(data).not.toHaveProperty('geo')
    expect(data).not.toHaveProperty('sameAs')
  })
})

describe('legal business identity', () => {
  it('keeps legal defaults empty and exposes only saved legal identity in JSON-LD', () => {
    const empty = resolveBusinessSettings(new Map())
    const facts = { barbers: [], services: [], schedules: [] }
    expect(empty.legalName).toBe('')
    expect(empty.organizationNumber).toBe('')
    expect(buildBusinessStructuredData(empty, facts, 'https://example.test')).not.toHaveProperty(
      'legalName',
    )
    expect(buildBusinessStructuredData(empty, facts, 'https://example.test')).not.toHaveProperty(
      'identifier',
    )
    const saved = resolveBusinessSettings(
      new Map([
        ['business_legal_name', ' Saved Company AB '],
        ['business_org_number', '556016-0680'],
      ]),
    )
    const data = buildBusinessStructuredData(saved, facts, 'https://example.test')
    expect(data.legalName).toBe('Saved Company AB')
    expect(data.identifier).toEqual({
      '@type': 'PropertyValue',
      propertyID: 'SE:Organisationsnummer',
      value: '556016-0680',
    })
  })
})
