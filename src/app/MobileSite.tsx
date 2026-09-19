import type { JSX } from 'preact'
import { MobileSite as renderMobile, type MobileSiteProps } from './MobileSiteSource'
import { useNativeSurface } from '../cms/NativeSurface'

export type { MobileSiteProps } from './MobileSiteSource'

export function MobileSite(props: MobileSiteProps): JSX.Element {
  return useNativeSurface(renderMobile(props), `mobile-${props.view}`, props.lang, props.mode)
}
