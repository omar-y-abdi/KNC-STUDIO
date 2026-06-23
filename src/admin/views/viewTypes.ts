// Shared type re-exports for the admin views. Keeps each view's import list short and gives the
// style bundle a stable name (`AdminStylesBundle`) the views reference.

export type { AdminStyles as AdminStylesBundle } from '../adminStyles'
export type {
  AboutKey,
  AboutRow,
  AdminBarber,
  AdminBarberId,
  AdminBooking,
  AdminProfile,
  AdminResult,
  GalleryImage,
  GalleryKind,
  TimeOff,
  Weekday,
  WeekSchedule,
} from '../types'
