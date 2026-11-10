import type { CmsDocument, CmsPresentation } from '@bladeblend/content-contracts/cms'
export type { CmsScene } from '../cms/Scene'
export { pageScenes } from '../cms/Scene'

export const PUBLIC_PREVIEW_PATH = '/cms-public/source'
export const PUBLIC_PREVIEW_URL = PUBLIC_PREVIEW_PATH + '?preview=1'
export const PREVIEW_MESSAGE = {
  context: 'knc-source-context',
  listening: 'knc-preview-listening',
  ready: 'knc-preview-ready',
  error: 'knc-preview-error',
  page: 'knc-preview-page',
} as const

export const SOURCE_SCENES = [
  'home',
  'booking',
  'my-bookings',
  'booking-options',
  'booking-details',
  'booking-confirmation',
  'my-bookings-list',
] as const

export interface SourceContext {
  id: string
  lang: 'sv' | 'en'
  mode: 'light' | 'dark'
  device: 'Desktop' | 'Mobile'
  scene: (typeof SOURCE_SCENES)[number]
  path?: string
  presentation?: CmsPresentation
  draft?: CmsDocument
  capture?: boolean
}
