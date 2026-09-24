import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsAsset } from '../../shared/cms'
import {
  assignResource,
  resourceDestination,
  matchesDestination,
} from '../../shared/cms-resource-assignment'

const image: CmsAsset = {
  id: '22222222-2222-4222-8222-222222222222',
  bucket: 'gallery',
  path: 'cuts/image.webp',
  name: 'Image',
  alt: 'A haircut',
  mime: 'image/webp',
  bytes: 1200,
  width: 600,
  height: 400,
  archived: false,
  version: 1,
}

describe('resource assignment changes the draft, not the inventory', () => {
  it('distinguishes storage purposes and isolates each barber', () => {
    expect(resourceDestination(image)).toEqual({ purpose: 'cuts' })
    expect(matchesDestination(image, { purpose: 'salon' })).toBe(false)
    expect(matchesDestination(image, { purpose: 'library' })).toBe(true)
    const portrait = { ...image, bucket: 'barber-photos' as const, path: 'a/image.webp' }
    expect(matchesDestination(portrait, { purpose: 'profile', barberId: 'b' })).toBe(false)
  })
  it('adds, deactivates and reactivates gallery membership without duplicating files', () => {
    const original = emptyDocument()
    const added = assignResource(original, image, { purpose: 'cuts' })
    expect(original.gallery).toEqual([])
    expect(added.gallery).toEqual([
      { id: image.id, kind: 'cuts', storage_path: image.path, alt: image.alt, sort_order: 0 },
    ])
    expect(assignResource(added, image, { purpose: 'cuts' }).gallery).toHaveLength(1)
    const hidden = assignResource(added, image, { purpose: 'cuts' }, false)
    expect(hidden.gallery).toEqual([])
    expect(assignResource(hidden, image, { purpose: 'cuts' }).gallery).toHaveLength(1)
    expect(image.archived).toBe(false)
  })
  it('refuses archived files and cross-scope assignments instead of weakening publication rules', () => {
    expect(() =>
      assignResource(emptyDocument(), { ...image, archived: true }, { purpose: 'cuts' }),
    ).toThrow()
    expect(() => assignResource(emptyDocument(), image, { purpose: 'salon' })).toThrow()
  })
  it('assigns a portrait to the chosen existing barber without touching the other barber', () => {
    const original = emptyDocument()
    original.barbers = ['a', 'b'].map((id) => ({
      id,
      name: id,
      ig: '',
      role_sv: '',
      role_en: '',
      bio_sv: '',
      bio_en: '',
      sort_order: 0,
    }))
    original.photos.b = 'b/existing.webp'
    const portrait = { ...image, bucket: 'barber-photos' as const, path: 'a/image.webp' }
    const next = assignResource(original, portrait, { purpose: 'profile', barberId: 'a' })
    expect(next.photos).toEqual({ a: portrait.path, b: 'b/existing.webp' })
    expect(original.photos).toEqual({ b: 'b/existing.webp' })
    expect(() =>
      assignResource(original, portrait, { purpose: 'profile', barberId: 'missing' }),
    ).toThrow()
  })
  it('registers uploaded fonts for the editor without selecting them for the whole site', () => {
    const font = {
      ...image,
      bucket: 'cms-library' as const,
      path: 'fonts/new.woff2',
      mime: 'font/woff2',
    }
    const next = assignResource(emptyDocument(), font, { purpose: 'fonts' })
    expect(next.presentation.fonts?.[font.id]).toEqual({
      ref: { bucket: font.bucket, path: font.path },
      name: font.name,
    })
    expect(next.presentation.themes).toEqual({ light: {}, dark: {} })
    expect(() => assignResource(emptyDocument(), font, { purpose: 'logo' })).toThrow()
  })
})
