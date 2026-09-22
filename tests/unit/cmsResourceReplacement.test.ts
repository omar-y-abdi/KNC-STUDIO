import { describe, expect, it, vi } from 'vitest'
import {
  defaultEmailDesign,
  emptyDocument,
  validateDocument,
  type CmsAsset,
} from '../../shared/cms'
import { replaceDocumentResource } from '../../shared/cms-resources'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ functions: { invoke } }),
}))
import { cmsApi } from '../../src/admin/cms/api'

const policy = { siteOrigin: 'https://salon.example', storageOrigin: 'https://fixture.supabase.co' }
const oldAsset: CmsAsset = {
  id: '22222222-2222-4222-8222-222222222222',
  bucket: 'cms-library',
  path: 'images/old.webp',
  name: 'Old image',
  alt: 'Salon',
  mime: 'image/webp',
  width: 40,
  height: 40,
  bytes: 100,
  archived: false,
  version: 1,
}
const newAsset: CmsAsset = {
  ...oldAsset,
  id: '33333333-3333-4333-8333-333333333333',
  path: 'images/new.webp',
  name: 'New image',
}

function imageDocument() {
  const document = emptyDocument()
  document.presentation.images.hero = {
    ref: { bucket: oldAsset.bucket, path: oldAsset.path },
    alt: { sv: 'Salong', en: 'Salon' },
  }
  const design = defaultEmailDesign()
  design.logo = { bucket: oldAsset.bucket, path: oldAsset.path }
  document.emails.push({
    template: 'customer_confirmation',
    lang: 'sv',
    subject: 'Bokning',
    preheader: 'Bokning',
    title: 'Bokning',
    intro: 'Välkommen',
    section_title: null,
    note: 'Tack',
    cta_label: 'Visa',
    contact_lead: null,
    design,
  })
  return document
}

describe('CMS resource wire boundaries', () => {
  it('projects a full asset onto the permitted metadata request fields', async () => {
    invoke.mockResolvedValueOnce({ data: newAsset, error: null })
    await cmsApi.asset(newAsset)
    expect(invoke).toHaveBeenLastCalledWith('cms-studio', {
      body: {
        operation: 'asset',
        id: newAsset.id,
        version: newAsset.version,
        name: newAsset.name,
        alt: newAsset.alt,
        archived: newAsset.archived,
      },
    })
  })
  it('keeps image assignments and email logos valid when upload returns a full asset', () => {
    const document = imageDocument()
    replaceDocumentResource(document, oldAsset, newAsset, policy)
    const expected = { bucket: newAsset.bucket, path: newAsset.path }
    expect(document.presentation.images.hero.ref).toEqual(expected)
    expect(document.emails[0]?.design?.logo).toEqual(expected)
    expect(() => validateDocument(document)).not.toThrow()
  })
  it('keeps uploaded font references within the same strict media contract', () => {
    const document = emptyDocument()
    const previous = { ...oldAsset, path: 'fonts/old.woff2', mime: 'font/woff2' }
    const next = { ...newAsset, path: 'fonts/new.woff2', mime: 'font/woff2' }
    document.presentation.fonts = {
      [oldAsset.id]: { ref: { bucket: previous.bucket, path: previous.path }, name: 'My font' },
    }
    replaceDocumentResource(document, previous, next, policy)
    expect(document.presentation.fonts[oldAsset.id]?.ref).toEqual({
      bucket: next.bucket,
      path: next.path,
    })
    expect(() => validateDocument(document)).not.toThrow()
  })
})
