// Shared type re-exports for the admin views. Keeps each view's import list short and gives the
// style bundle a stable name (`AdminStylesBundle`) the views reference.

export type { AdminStyles as AdminStylesBundle } from '../adminStyles'
export type {
  AdminBarber,
  AdminBarberId,
  AdminBooking,
  AdminService,
  RecurringBreak,
  SlotBlock,
  TimeOff,
  Weekday,
  WeekSchedule,
} from '../types'

/** A one-line outcome a card shows in its aria-live region (`err` renders in the error colour). */
export interface StatusMessage {
  readonly kind: 'ok' | 'err'
  readonly text: string
}
