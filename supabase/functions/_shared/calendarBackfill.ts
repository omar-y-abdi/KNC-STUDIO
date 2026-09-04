// OAuth callback backfill seam.  It only selects durable sync work; Google I/O stays in the
// external-action worker so reassignment and reconnects share one lifecycle.

interface CalendarBackfillService {
  rpc(
    name: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: { readonly message?: string } | null }>
}

interface BackfillBooking {
  readonly id: string
  readonly google_event_id: string | null
  readonly mapped_barber_id: string | null
  readonly mapped_calendar_id: string | null
  readonly mapped_google_event_id: string | null
}

/** Queue every future booking whose mapping is not already current.  The durable worker owns all
 * Google writes so reassignment uses delete-old-before-create ordering, including a previously
 * unlinked destination that connects later. */
export async function queueBackfill(
  service: CalendarBackfillService,
  barberId: string,
): Promise<void> {
  const { data, error } = await service.rpc('calendar_backfill_source', { p_barber_id: barberId })
  if (error || data === null || typeof data !== 'object') return
  const source = data as Record<string, unknown>
  const calendarId = source['calendar_id']
  const rows = Array.isArray(source['bookings']) ? (source['bookings'] as BackfillBooking[]) : []
  if (typeof calendarId !== 'string' || calendarId.length === 0 || rows.length === 0) return

  for (const booking of rows) {
    const mappingIsCurrent =
      booking.google_event_id !== null &&
      booking.mapped_barber_id === barberId &&
      booking.mapped_calendar_id === calendarId &&
      booking.mapped_google_event_id === booking.google_event_id
    if (mappingIsCurrent) continue

    const { error: queueError } = await service.rpc('queue_calendar_event_sync', {
      p_booking_id: booking.id,
    })
    if (queueError !== null) {
      await service.rpc('calendar_record_error', {
        p_barber_id: barberId,
        p_error: `backfill queue ${booking.id}: ${queueError.message ?? 'unknown'}`,
      })
    }
  }
}
