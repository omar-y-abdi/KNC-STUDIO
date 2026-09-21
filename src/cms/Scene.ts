import { createContext } from 'preact'
import type { MyBookingsPort } from '../mybookings/port'

export type CmsScene =
  'default' | 'booking-options' | 'booking-details' | 'booking-confirmation' | 'my-bookings-list'

/** Present only inside the isolated CMS source/preview. Never populated from public URL state. */
export const CmsSceneContext = createContext<{
  booking?: 'options' | 'details' | 'confirmation'
  customer?: { port: MyBookingsPort; expandedId: string }
} | null>(null)

export const pageScenes = (path: string): readonly { id: CmsScene; label: string }[] =>
  path === '/booking'
    ? [
        { id: 'default', label: 'Barberare' },
        { id: 'booking-options', label: 'Dag, behandling & tid' },
        { id: 'booking-details', label: 'Kunduppgifter' },
        { id: 'booking-confirmation', label: 'Bokningsbekräftelse' },
      ]
    : path === '/my-bookings'
      ? [
          { id: 'default', label: 'Be om säker länk' },
          { id: 'my-bookings-list', label: 'Bokningslista' },
        ]
      : []
