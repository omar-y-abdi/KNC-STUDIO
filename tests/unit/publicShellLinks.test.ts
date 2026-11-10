import { describe, expect, it } from 'vitest'
import { outageLinks } from '../../modules/public-web/src/cms/NativeSurface'
import { langHref } from '../../modules/public-web/src/ui/langHref'

describe('langHref', () => {
  it('keeps the bare path in Swedish and names English in the query', () => {
    expect(langHref('/terms', 'sv')).toBe('/terms')
    expect(langHref('/terms', 'en')).toBe('/terms?lang=en')
    expect(langHref('/privacy', 'en')).toBe('/privacy?lang=en')
  })
})

describe('outage links', () => {
  it('names the contact and legal pages in Swedish without a language query', () => {
    expect(outageLinks('')).toEqual([
      { href: '/contact', label: 'Kontakt' },
      { href: '/terms', label: 'Villkor' },
      { href: '/privacy', label: 'Integritetspolicy' },
    ])
  })

  it('names them in English with ?lang=en when the address says English', () => {
    expect(outageLinks('?mode=dark&lang=en')).toEqual([
      { href: '/contact?lang=en', label: 'Contact' },
      { href: '/terms?lang=en', label: 'Terms' },
      { href: '/privacy?lang=en', label: 'Privacy policy' },
    ])
  })

  it.each(['?lang=sv', '?lang=de', '?mode=dark'])(
    'reads %s as Swedish, as the app does',
    (search) => {
      expect(outageLinks(search).map((link) => link.href)).toEqual([
        '/contact',
        '/terms',
        '/privacy',
      ])
    },
  )
})
