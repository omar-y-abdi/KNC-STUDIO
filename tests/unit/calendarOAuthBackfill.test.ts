import { describe, expect, it, vi } from 'vitest'
import { queueBackfill } from '../../supabase/functions/_shared/calendarBackfill'

const OLD_ASSIGNMENT = '54000000-0000-0000-0000-000000000001'
const CURRENT_ASSIGNMENT = '54000000-0000-0000-0000-000000000002'
const UNMAPPED = '54000000-0000-0000-0000-000000000003'

describe('Calendar OAuth backfill', () => {
  it('queues old and unmapped identities for the durable worker, including an old map after relink', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'calendar_backfill_source') {
        return {
          data: {
            calendar_id: 'destination-calendar',
            bookings: [
              {
                id: OLD_ASSIGNMENT,
                google_event_id: null,
                mapped_barber_id: 'source-barber',
                mapped_calendar_id: 'source-calendar',
                mapped_google_event_id: 'old-event',
              },
              {
                id: CURRENT_ASSIGNMENT,
                google_event_id: 'current-event',
                mapped_barber_id: 'destination-barber',
                mapped_calendar_id: 'destination-calendar',
                mapped_google_event_id: 'current-event',
              },
              {
                id: UNMAPPED,
                google_event_id: null,
                mapped_barber_id: null,
                mapped_calendar_id: null,
                mapped_google_event_id: null,
              },
            ],
          },
          error: null,
        }
      }
      return { data: 'queued', error: null }
    })

    await queueBackfill({ rpc }, 'destination-barber')

    expect(rpc).toHaveBeenNthCalledWith(1, 'calendar_backfill_source', {
      p_barber_id: 'destination-barber',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'queue_calendar_event_sync', {
      p_booking_id: OLD_ASSIGNMENT,
    })
    expect(rpc).toHaveBeenNthCalledWith(3, 'queue_calendar_event_sync', {
      p_booking_id: UNMAPPED,
    })
    expect(rpc).not.toHaveBeenCalledWith('queue_calendar_event_sync', {
      p_booking_id: CURRENT_ASSIGNMENT,
    })
  })

  it('does not perform provider or mapping writes while selecting backfill work', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'calendar_backfill_source') {
        return {
          data: { calendar_id: 'destination-calendar', bookings: [] },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    await queueBackfill({ rpc }, 'destination-barber')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalledWith('calendar_record_event', expect.anything())
  })
})
