// Shared homepage logo renderer. Defaults preserve existing vector pixels; uploaded logo bytes are
// server-processed WebP objects from the public gallery bucket and can only receive bounded styling.

import type { JSX } from 'preact'
import { DeskLockup } from '../ui/logos/DeskLockup'
import { HeroLockup } from '../ui/logos/HeroLockup'
import { scalePx, type HomepageLogo } from './siteChrome'

export interface HomepageLogoProps {
  readonly logo: HomepageLogo
  readonly layout: 'desktop' | 'mobile'
  readonly height: number
  readonly style?: JSX.CSSProperties
}

export function HomepageLogo(props: HomepageLogoProps): JSX.Element {
  const height = scalePx(props.height, props.logo.scale)
  if (props.logo.url !== null) {
    return (
      <img
        src={props.logo.url}
        alt="Blade & Blend Studio"
        style={{
          ...props.style,
          display: 'block',
          height: `${height}px`,
          maxWidth: 'min(460px, 80vw)',
          objectFit: 'contain',
          filter: props.logo.style === 'monochrome' ? 'grayscale(1) contrast(1.12)' : undefined,
        }}
      />
    )
  }
  return props.layout === 'desktop' ? (
    <DeskLockup height={height} {...(props.style === undefined ? {} : { style: props.style })} />
  ) : (
    <HeroLockup height={height} {...(props.style === undefined ? {} : { style: props.style })} />
  )
}
