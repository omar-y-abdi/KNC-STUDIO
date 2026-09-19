import { createContext } from 'preact'
import type { DesktopSitePreviewPorts } from '../app/DesktopSiteSource'

export const PreviewPorts = createContext<DesktopSitePreviewPorts | undefined>(undefined)
