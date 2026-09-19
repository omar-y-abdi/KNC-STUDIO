import type { JSX } from 'preact'
import { useContext } from 'preact/hooks'
import { DesktopSite as renderDesktop, type DesktopSiteProps } from './DesktopSiteSource'
import { useNativeSurface } from '../cms/NativeSurface'
import { PreviewPorts } from '../cms/PreviewPorts'

export type { DesktopSiteProps, DesktopSitePreviewPorts } from './DesktopSiteSource'

export function DesktopSite(props: DesktopSiteProps): JSX.Element {
  const ports = useContext(PreviewPorts)
  return useNativeSurface(
    renderDesktop(ports ? { ...props, previewPorts: ports } : props),
    `desktop-${props.view}`,
    props.lang,
    props.mode,
  )
}
