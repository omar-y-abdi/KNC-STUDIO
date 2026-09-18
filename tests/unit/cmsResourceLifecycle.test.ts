import { describe, expect, it } from 'vitest'
import { emptyPresentation, type CmsAsset } from '../../shared/cms'
import {
  filterResources,
  fontAssetForFamily,
  grapesImageAssets,
  resourceDeleting,
  resourceFontOptions,
  resourceState,
  resourceUsable,
} from '../../src/admin/cms/resourceLifecycle'

type TestAsset = CmsAsset & { trashed?: boolean; deleting?: boolean }
const asset = (overrides: Partial<TestAsset> = {}): TestAsset => ({
  id: '10000000-0000-4000-8000-000000000001',
  bucket: 'cms-library',
  path: 'images/photo.webp',
  name: 'Photo',
  alt: 'Alt',
  mime: 'image/webp',
  width: 1200,
  height: 800,
  bytes: 1024,
  archived: false,
  version: 0,
  ...overrides,
})

describe('CMS resource lifecycle view model', () => {
  it('derives active, archived and trash states without making deleting resources usable', () => {
    expect(resourceState(asset())).toBe('active')
    expect(resourceState(asset({ archived: true }))).toBe('archived')
    expect(resourceState(asset({ archived: true, trashed: true }))).toBe('trash')
    expect(resourceUsable(asset())).toBe(true)
    expect(resourceDeleting(asset({ deleting: true }))).toBe(true)
    expect(resourceUsable(asset({ deleting: true }))).toBe(false)
  })

  it('filters one canonical inventory by lifecycle, type, query and purpose eligibility', () => {
    const resources = [
      asset(),
      asset({ id: '10000000-0000-4000-8000-000000000002', name: 'Archived', archived: true }),
      asset({
        id: '10000000-0000-4000-8000-000000000003',
        path: 'fonts/custom.woff2',
        name: 'Custom font',
        mime: 'font/woff2',
        width: null,
        height: null,
      }),
    ]
    expect(
      filterResources(resources, { state: 'active', kind: 'images', query: 'photo' }).map(
        (item) => item.id,
      ),
    ).toEqual(['10000000-0000-4000-8000-000000000001'])
    expect(
      filterResources(resources, {
        state: 'active',
        kind: 'all',
        eligible: (item) => item.mime === 'font/woff2',
      }).map((item) => item.id),
    ).toEqual(['10000000-0000-4000-8000-000000000003'])
  })

  it('exposes only active images to GrapesJS AssetManager', () => {
    const resources = [
      asset(),
      asset({ id: '10000000-0000-4000-8000-000000000002', archived: true }),
      asset({
        id: '10000000-0000-4000-8000-000000000003',
        path: 'images/trash.webp',
        archived: true,
        trashed: true,
      }),
      asset({
        id: '10000000-0000-4000-8000-000000000004',
        path: 'fonts/custom.woff2',
        mime: 'font/woff2',
        width: null,
        height: null,
      }),
    ]
    expect(grapesImageAssets(resources, 'https://fixture.supabase.co')).toEqual([
      {
        src: 'https://fixture.supabase.co/storage/v1/object/public/cms-library/images/photo.webp',
        name: 'Photo',
        width: 1200,
        height: 800,
      },
    ])
  })

  it('offers active WOFF2 files immediately and resolves them for registration on first use', () => {
    const activeFont = asset({
      id: '10000000-0000-4000-8000-000000000010',
      path: 'fonts/active.woff2',
      name: 'Active font',
      mime: 'font/woff2',
      width: null,
      height: null,
    })
    const archivedFont = asset({
      id: '10000000-0000-4000-8000-000000000011',
      path: 'fonts/archived.woff2',
      name: 'Archived font',
      mime: 'font/woff2',
      width: null,
      height: null,
      archived: true,
    })
    const presentation = emptyPresentation()
    expect(resourceFontOptions(presentation, [activeFont, archivedFont])).toContainEqual([
      'CMSFont-10000000-0000-4000-8000-000000000010',
      'Active font',
    ])
    expect(fontAssetForFamily([activeFont], 'CMSFont-10000000-0000-4000-8000-000000000010')).toBe(
      activeFont,
    )
    expect(
      fontAssetForFamily([archivedFont], 'CMSFont-10000000-0000-4000-8000-000000000011'),
    ).toBeUndefined()

    presentation.fonts = {
      [activeFont.id]: {
        ref: { bucket: activeFont.bucket, path: activeFont.path },
        name: activeFont.name,
      },
    }
    expect(
      resourceFontOptions(presentation, [activeFont]).filter(
        ([value]) => value === 'CMSFont-10000000-0000-4000-8000-000000000010',
      ),
    ).toHaveLength(1)
  })
})
