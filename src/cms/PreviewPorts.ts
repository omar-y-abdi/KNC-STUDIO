import { createContext } from 'preact'
import type { DesktopSitePreviewPorts } from '../app/DesktopSite'
import type { MyBookingsPort } from '../mybookings/port'

export const PreviewPorts = createContext<DesktopSitePreviewPorts | undefined>(undefined)

// Source inspection must not load the owner's customer history or issue public writes.
export const previewCustomerPort: MyBookingsPort = {
  list: async () => ({ ok: false, error: 'access_denied' }),
  requestEmailLink: async () => ({ ok: false, error: 'access_denied' }),
  confirmEmailLink: async () => ({ ok: false, error: 'access_denied' }),
  requestAccess: async () => ({ ok: false, error: 'system' }),
  exchangeAccess: async () => ({ ok: false, error: 'invalid' }),
  cancel: async () => ({ ok: false, error: 'access_denied' }),
}
