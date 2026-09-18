import { describe, expect, it } from 'vitest'
import { enrichLegalMarkup } from '../../src/cms/legal'
import type { BusinessSettings } from '../../src/site/business'

const BUSINESS: BusinessSettings = {
  name: 'Current Studio',
  legalName: 'Current Studio AB',
  organizationNumber: '559999-1234',
  email: 'legal@example.test',
  phoneDisplay: '031-555 12 34',
  phoneTel: '+46315551234',
  street: 'Currentgatan 7',
  postalCode: '411 11',
  city: 'Göteborg',
  mapsHref: '',
  cancellationPolicyHours: 37,
  seo: {
    sv: { title: 'SV', description: 'SV' },
    en: { title: 'EN', description: 'EN' },
  },
}

describe('CMS legal authoritative markup', () => {
  it('replaces serialized legal placeholders with current business facts', () => {
    const html =
      '<span data-business-name="">salongen</span>' +
      '<span data-business-controller="sv">Salongen</span>' +
      '<span data-business-contact=""><a href="/">kontakt</a></span>' +
      '<div id="legal-business-details-sv"></div>' +
      '<p id="cancellation-policy-sv"></p>'

    const result = enrichLegalMarkup(html, BUSINESS)

    expect(result).toContain('<span data-business-name>Current Studio</span>')
    expect(result).toContain(
      '<span data-business-controller="sv">Current Studio AB</span>',
    )
    expect(result).toContain('mailto:legal@example.test')
    expect(result).toContain('559999-1234')
    expect(result).toContain('Currentgatan 7, 411 11 Göteborg')
    expect(result).toContain('Avboka senast 37 timmar före den bokade tiden.')
    expect(result).not.toContain('>salongen<')
  })
})
