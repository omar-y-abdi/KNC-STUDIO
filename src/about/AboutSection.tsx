import type { JSX } from 'preact'
import { useContext } from 'preact/hooks'
import { AboutSection as renderAbout, type AboutSectionProps } from './AboutSectionSource'
import { useNativeSurface } from '../cms/NativeSurface'
import { PreviewPorts } from '../cms/PreviewPorts'

export { ABOUT_SECTION_ID } from './AboutSectionSource'
export type { AboutSectionProps } from './AboutSectionSource'

export function AboutSection(props: AboutSectionProps): JSX.Element {
  const ports = useContext(PreviewPorts)
  const source = renderAbout(
    ports
      ? {
          ...props,
          port: ports.reviews,
          barbersPort: ports.barbers,
          aboutContentPort: ports.aboutContent,
          galleryPort: ports.gallery,
          challengeEnabled: false,
        }
      : props,
  )
  return useNativeSurface(source, 'about', props.lang, props.mode)
}
