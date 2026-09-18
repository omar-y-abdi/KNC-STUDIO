import { describe, expect, it } from 'vitest'
import { mediaUrl, type CmsAsset } from '../../shared/cms'

describe('CMS asset media URLs', () => {
  it('accepts a validated CmsAsset even though it carries metadata beyond its media reference', () => {
    const asset: CmsAsset = {
      id: '00000000-0000-4000-8000-000000000001',
      bucket: 'cms-library',
      path: 'library/example.webp',
      name: 'example.webp',
      alt: 'Example',
      mime: 'image/webp',
      width: 1,
      height: 1,
      bytes: 64,
      archived: false,
      version: 0,
    }

    expect(mediaUrl(asset, 'https://fixture.supabase.co')).toBe(
      'https://fixture.supabase.co/storage/v1/object/public/cms-library/library/example.webp',
    )
  })
})
