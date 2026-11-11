// Cuts gallery content and credits: the owner's pictures credited to the studio, then the barbers'
// visible work pictures round-robin in roster order, each credited to its barber.

import type { RosterBarber } from '../booking/barbersPort'
import { STUDIO_INSTAGRAM } from '../site/business'
import type { GalleryCredit, GalleryPhoto } from './gallery/port'

const STUDIO_CREDIT: GalleryCredit = { platform: 'instagram', handle: STUDIO_INSTAGRAM }

/** Instagram, else TikTok, else no credit. */
export function barberCredit(entry: RosterBarber): GalleryCredit | null {
  if (entry.barber.ig !== '') return { platform: 'instagram', handle: entry.barber.ig }
  const tiktok = entry.tiktok ?? ''
  return tiktok === '' ? null : { platform: 'tiktok', handle: tiktok }
}

/** The owner's cuts photos in their order, then each barber's first picture, then each second… */
export function cutsWithWork(
  owner: readonly GalleryPhoto[],
  roster: readonly RosterBarber[],
): readonly GalleryPhoto[] {
  const queues = roster.map((entry) => ({ urls: entry.work ?? [], credit: barberCredit(entry) }))
  const rounds = queues.reduce((most, { urls }) => Math.max(most, urls.length), 0)
  const work: GalleryPhoto[] = []
  for (let round = 0; round < rounds; round++)
    for (const { urls, credit } of queues) {
      const url = urls[round]
      if (url !== undefined) work.push({ id: url, url, alt: '', ...(credit ? { credit } : {}) })
    }
  return [...owner.map((photo) => ({ ...photo, credit: STUDIO_CREDIT })), ...work]
}

export interface CreditLink {
  readonly href: string
  /** Accessible name. */
  readonly label: string
  readonly text: string
}

export function creditLink({ platform, handle }: GalleryCredit): CreditLink {
  const text = `@${handle}`
  return platform === 'instagram'
    ? { href: `https://www.instagram.com/${handle}/`, label: `Instagram ${text}`, text }
    : { href: `https://www.tiktok.com/${text}`, label: `TikTok ${text}`, text }
}
