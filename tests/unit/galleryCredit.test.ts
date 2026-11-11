import { describe, expect, it } from 'vitest'
import {
  barberCredit,
  creditLink,
  cutsWithWork,
} from '../../modules/public-web/src/about/galleryCredit'
import type { GalleryPhoto } from '../../modules/public-web/src/about/gallery/port'
import type { RosterBarber } from '../../modules/public-web/src/booking/barbersPort'
import { asBarberId } from '../../modules/public-web/src/booking/domain'
import { STUDIO_INSTAGRAM } from '../../modules/public-web/src/site/business'

const barber = (
  id: string,
  ig: string,
  extra: { readonly tiktok?: string; readonly work?: readonly string[] } = {},
): RosterBarber => ({
  barber: { id: asBarberId(id), name: id, ig },
  copy: null,
  photoUrl: null,
  ...extra,
})
const owner: readonly GalleryPhoto[] = [
  { id: 'cut-1', url: '/gallery/cut-1.webp', alt: 'Fade' },
  { id: 'cut-2', url: '/gallery/cut-2.webp', alt: '' },
]

describe('cuts gallery content', () => {
  it('keeps the owner photos first, in order, credited to the studio Instagram', () => {
    expect(STUDIO_INSTAGRAM).toBe('bnbstudio_gbg')
    expect(cutsWithWork(owner, [])).toEqual([
      { ...owner[0], credit: { platform: 'instagram', handle: 'bnbstudio_gbg' } },
      { ...owner[1], credit: { platform: 'instagram', handle: 'bnbstudio_gbg' } },
    ])
  })

  it('follows them with work pictures round-robin across the roster in roster order', () => {
    const roster = [
      barber('a', 'anna', { work: ['/w/a1', '/w/a2', '/w/a3'] }),
      barber('b', 'bo'),
      barber('c', 'cem', { work: ['/w/c1'] }),
      barber('d', 'dan', { work: ['/w/d1', '/w/d2'] }),
    ]
    const photos = cutsWithWork(owner, roster)
    expect(photos.map((photo) => photo.url)).toEqual([
      '/gallery/cut-1.webp',
      '/gallery/cut-2.webp',
      '/w/a1',
      '/w/c1',
      '/w/d1',
      '/w/a2',
      '/w/d2',
      '/w/a3',
    ])
    expect(photos.slice(2).map((photo) => photo.credit?.handle)).toEqual([
      'anna',
      'cem',
      'dan',
      'anna',
      'dan',
      'anna',
    ])
    expect(new Set(photos.map((photo) => photo.id)).size).toBe(photos.length)
    expect(photos.slice(2).every((photo) => photo.alt === '')).toBe(true)
  })

  it('shows exactly the pictures the catalog lists, so a hidden picture never arrives', () => {
    const photos = cutsWithWork([], [barber('a', 'anna', { work: ['/w/visible'] })])
    expect(photos).toEqual([
      {
        id: '/w/visible',
        url: '/w/visible',
        alt: '',
        credit: { platform: 'instagram', handle: 'anna' },
      },
    ])
  })

  it('treats a roster entry without work pictures, or an older catalog, as having none', () => {
    expect(cutsWithWork(owner, [barber('a', 'anna'), barber('b', '', { work: [] })])).toHaveLength(
      2,
    )
  })
})

describe('work picture credit', () => {
  it('credits Instagram first, then TikTok, then nobody', () => {
    expect(barberCredit(barber('a', 'anna', { tiktok: 'anna.tt' }))).toEqual({
      platform: 'instagram',
      handle: 'anna',
    })
    expect(barberCredit(barber('a', '', { tiktok: 'anna.tt' }))).toEqual({
      platform: 'tiktok',
      handle: 'anna.tt',
    })
    expect(barberCredit(barber('a', '', { tiktok: '' }))).toBeNull()
    expect(barberCredit(barber('a', ''))).toBeNull()
  })

  it('leaves a work picture of a barber without handles uncredited', () => {
    const [photo] = cutsWithWork([], [barber('a', '', { work: ['/w/a1'] })])
    expect(photo).toEqual({ id: '/w/a1', url: '/w/a1', alt: '' })
    expect(photo !== undefined && 'credit' in photo).toBe(false)
  })

  it('links a credit to the profile and names the platform', () => {
    expect(creditLink({ platform: 'instagram', handle: 'bnbstudio_gbg' })).toEqual({
      href: 'https://www.instagram.com/bnbstudio_gbg/',
      label: 'Instagram @bnbstudio_gbg',
      text: '@bnbstudio_gbg',
    })
    expect(creditLink({ platform: 'tiktok', handle: 'anna.tt' })).toEqual({
      href: 'https://www.tiktok.com/@anna.tt',
      label: 'TikTok @anna.tt',
      text: '@anna.tt',
    })
  })
})
