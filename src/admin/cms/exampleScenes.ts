import { asBarberId } from '../../booking/domain'
import type { DesktopSitePreviewPorts } from '../../app/DesktopSite'
import { previewCustomerPort } from '../../cms/PreviewPorts'
import type { MyBookingsPort } from '../../mybookings/port'

const barber = { id: asBarberId('cms-example'), name: 'Exempelbarberare', ig: 'exempel' }
const service = { id: 'cms-example-service', name: 'Klippning', price: 350, dur: 45 }

/** Only isolated source/preview scenes receive these ports. Every write remains denied. */
export function exampleBookingPorts(read: DesktopSitePreviewPorts): DesktopSitePreviewPorts {
  return {
    ...read,
    barbers: {
      listActive: async () => {
        const roster = await read.barbers.listActive()
        return roster.length ? roster : [{ barber, copy: null, photoUrl: null }]
      },
    },
    services: {
      listForBarber: async (id, date) => {
        const menu = await read.services.listForBarber(id, date)
        return menu.length ? menu : [service]
      },
    },
    booking: {
      ...read.booking,
      availability: async () => ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'],
    },
  }
}

export const exampleBookingId = 'cms-example-booking'
export const exampleCustomerPort: MyBookingsPort = {
  ...previewCustomerPort,
  list: async ({ lang }) => {
    const start = new Date()
    start.setDate(start.getDate() + 3)
    start.setHours(10, 30, 0, 0)
    return {
      ok: true,
      authority: 'verified',
      profile: { name: 'Exempelkund', phone: '0700000000', email: 'kund@example.test' },
      bookings: {
        upcoming: [
          {
            id: exampleBookingId,
            barber,
            serviceName: service.name,
            price: service.price,
            durationMin: service.dur,
            start,
            whenLabel: start.toLocaleString(lang === 'en' ? 'en-GB' : 'sv-SE', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        ],
        past: [],
      },
    }
  },
}
