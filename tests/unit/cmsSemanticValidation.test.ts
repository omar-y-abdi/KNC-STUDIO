import { describe, expect, it } from 'vitest'
import {
  defaultEmailDesign,
  emptyDocument,
  validateCompleteDocument,
  validateDocument,
  validateDocumentMedia,
  type CmsAsset,
  type CmsBarber,
  type CmsDocument,
  type CmsEmail,
  type MediaRef,
} from '../../shared/cms'

const barber = (): CmsBarber => ({
  id: 'test-barber',
  name: 'Test',
  ig: '',
  role_sv: '',
  role_en: '',
  bio_sv: '',
  bio_en: '',
  sort_order: 0,
})
const email = (): CmsEmail => ({
  template: 'customer_confirmation',
  lang: 'sv',
  subject: 'Subject',
  preheader: 'Preheader',
  title: 'Title',
  intro: 'Intro',
  section_title: null,
  note: 'Note',
  cta_label: 'Open',
  contact_lead: null,
  design: null,
})
const asset = (ref: MediaRef, mime: string): CmsAsset => ({
  id: '00000000-0000-4000-8000-000000000001',
  ...ref,
  name: 'Fixture',
  alt: '',
  mime,
  width: mime.startsWith('image/') ? 1 : null,
  height: mime.startsWith('image/') ? 1 : null,
  bytes: 1,
  archived: false,
  version: 0,
})
const invalid = (change: (document: CmsDocument) => void): void => {
  const document = emptyDocument()
  change(document)
  expect(() => validateDocument(document)).toThrow()
}

describe('CMS database semantic parity', () => {
  it('matches the site_content 400-character database ceiling', () => {
    invalid((document) => {
      document.site.kicker = { sv: 'x'.repeat(401) }
    })
  })

  it.each([
    ['homepage_scale', 'xx'],
    ['about_scale', 'xx'],
    ['homepage_logo_scale', 'xx'],
    ['homepage_logo_style', 'color'],
    ['homepage_logo_path', 'logo/not-a-uuid.webp'],
    ['business_name', ''],
    ['business_street', ''],
    ['business_city', ''],
    ['business_legal_name', 'bad\u0007name'],
    ['business_legal_name', 'x'.repeat(161)],
    ['business_org_number', '123'],
    ['business_email', 'not-an-email'],
    ['business_phone_display', 'x'.repeat(81)],
    ['business_phone_tel', '+12'],
    ['business_postal_code', '1234'],
    ['business_maps_href', 'http://example.com'],
    ['seo_title_sv', ''],
    ['seo_title_en', 'x'.repeat(121)],
    ['seo_description_sv', ''],
    ['seo_description_en', 'x'.repeat(501)],
  ])('rejects a DB-invalid %s setting', (key, value) => {
    invalid((document) => {
      document.settings[key] = value
    })
  })

  it('accepts values that the database trigger can normalize without rejecting', () => {
    const document = emptyDocument()
    Object.assign(document.settings, {
      business_org_number: ' 5566778899 ',
      business_email: ' Owner@Example.com ',
      business_phone_tel: ' (031) 123-456 ',
      business_postal_code: ' 411 34 ',
      business_maps_href: ' https://maps.example.com/place ',
    })
    expect(() => validateDocument(document)).not.toThrow()
  })

  it('requires settings present in the authoritative base without inventing absent settings', () => {
    const authoritative = emptyDocument()
    authoritative.settings['business_name'] = 'Studio'

    const missing = structuredClone(authoritative)
    delete missing.settings['business_name']
    expect(() => validateCompleteDocument(missing, authoritative)).toThrow(
      'settings.business_name: Required setting is missing',
    )

    const withoutOptionalSetting = emptyDocument()
    expect(() =>
      validateCompleteDocument(withoutOptionalSetting, withoutOptionalSetting),
    ).not.toThrow()
  })

  it('requires email variants present in the authoritative base without inventing absent variants', () => {
    const authoritative = emptyDocument()
    authoritative.emails.push(email())

    const missing = structuredClone(authoritative)
    missing.emails = []
    expect(() => validateCompleteDocument(missing, authoritative)).toThrow(
      'emails.customer_confirmation.sv: Required email variant is missing',
    )

    const withoutOptionalEmail = emptyDocument()
    expect(() => validateCompleteDocument(withoutOptionalEmail, withoutOptionalEmail)).not.toThrow()
  })

  it('matches barber name and biography limits', () => {
    invalid((document) => {
      const item = barber()
      item.name = 'x'.repeat(61)
      document.barbers.push(item)
    })
    for (const field of ['bio_sv', 'bio_en'] as const)
      invalid((document) => {
        const item = barber()
        item[field] = 'x'.repeat(601)
        document.barbers.push(item)
      })
  })

  it('matches the gallery storage path limit', () => {
    invalid((document) => {
      document.gallery.push({
        id: '00000000-0000-4000-8000-000000000001',
        kind: 'salon',
        storage_path: `salon/${'a'.repeat(195)}.webp`,
        alt: '',
        sort_order: 0,
      })
    })
  })

  it('matches nullable and bounded email template fields', () => {
    invalid((document) => {
      const item = email()
      item.cta_label = 'x'.repeat(81)
      document.emails.push(item)
    })
    for (const sectionTitle of ['', 'x'.repeat(121)])
      invalid((document) => {
        const item = email()
        item.section_title = sectionTitle
        document.emails.push(item)
      })
    for (const contactLead of ['', 'x'.repeat(241)])
      invalid((document) => {
        const item = email()
        item.contact_lead = contactLead
        document.emails.push(item)
      })
  })
})

describe('CMS media assignment parity', () => {
  it('requires image MIME for native presentation images', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'cms-library', path: 'fonts/test.woff2' }
    document.presentation.images['home.image'] = {
      ref,
      alt: { sv: 'Bild', en: 'Image' },
    }
    expect(() => validateDocumentMedia(document, [asset(ref, 'font/woff2')])).toThrow()
  })

  it('requires WOFF2 MIME for registered fonts', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'cms-library', path: 'fonts/test.woff2' }
    document.presentation.fonts = {
      '00000000-0000-4000-8000-000000000001': { ref, name: 'Fixture' },
    }
    expect(() => validateDocumentMedia(document, [asset(ref, 'image/webp')])).toThrow()
  })

  it('requires uploaded fonts to come from the font upload purpose', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'cms-library', path: 'images/test.woff2' }
    document.presentation.fonts = {
      '00000000-0000-4000-8000-000000000001': { ref, name: 'Fixture' },
    }
    expect(() => validateDocumentMedia(document, [asset(ref, 'font/woff2')])).toThrow()
  })

  it('requires authored markup resource references to be images', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'cms-library', path: 'fonts/test.woff2' }
    expect(() => validateDocumentMedia(document, [asset(ref, 'font/woff2')], [ref])).toThrow()
  })

  it('requires gallery images to stay inside their declared purpose', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'gallery', path: 'salon/test.webp' }
    document.gallery.push({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'cuts',
      storage_path: ref.path,
      alt: '',
      sort_order: 0,
    })
    expect(() => validateDocumentMedia(document, [asset(ref, 'image/webp')])).toThrow()
  })

  it('requires image MIME for gallery placements', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'gallery', path: 'salon/test.webp' }
    document.gallery.push({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'salon',
      storage_path: ref.path,
      alt: '',
      sort_order: 0,
    })
    expect(() => validateDocumentMedia(document, [asset(ref, 'font/woff2')])).toThrow()
  })

  it('requires image MIME for barber profile photos', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'barber-photos', path: 'test-barber/photo.webp' }
    document.barbers.push(barber())
    document.photos['test-barber'] = ref.path
    expect(() => validateDocumentMedia(document, [asset(ref, 'font/woff2')])).toThrow()
  })

  it('requires image MIME for the homepage logo', () => {
    const document = emptyDocument()
    const ref: MediaRef = {
      bucket: 'gallery',
      path: 'logo/00000000-0000-4000-8000-000000000001.webp',
    }
    document.settings['homepage_logo_path'] = ref.path
    expect(() => validateDocumentMedia(document, [asset(ref, 'font/woff2')])).toThrow()
  })

  it('requires image MIME for email logos', () => {
    const document = emptyDocument()
    const ref: MediaRef = { bucket: 'cms-library', path: 'images/email.webp' }
    const item = email()
    item.design = defaultEmailDesign()
    item.design.logo = ref
    document.emails.push(item)
    expect(() => validateDocumentMedia(document, [asset(ref, 'font/woff2')])).toThrow()
  })

  it('accepts assignments that match the upload and picker contract', () => {
    const ref: MediaRef = { bucket: 'gallery', path: 'salon/test.webp' }
    const document = emptyDocument()
    document.gallery.push({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'salon',
      storage_path: ref.path,
      alt: '',
      sort_order: 0,
    })
    expect(() => validateDocumentMedia(document, [asset(ref, 'image/webp')])).not.toThrow()
  })
})
