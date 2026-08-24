import { invokePublicBookingAction } from '../../backend/publicBookingActions'
import {
  customerAccessExchangeResponse,
  customerAccessRequestResponse,
  customerBookingCancelResponse,
  listCustomerBookingsResponse,
  parseWith,
} from '../../backend/rpcSchemas'
import { defaultBarbersPort } from '../../booking/adapters/barbersIndex'
import type { Barber } from '../../booking/domain'
import { asBarberId } from '../../booking/domain'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import { myBookingsStrings } from '../../i18n/index'
import { forgetCustomerAccessToken, rememberCustomerAccessToken } from '../customerAccessSession'
import { rememberPhone } from '../deviceMemory'
import type { MyBooking, MyBookingsResult, MyCancelResult } from '../domain'
import { formatRowLabel, splitByTime } from '../format'
import type {
  MyBookingsAccessExchangeResult,
  MyBookingsAccessRequestParams,
  MyBookingsAccessRequestResult,
  MyBookingsListParams,
  MyBookingsPort,
} from '../port'

async function barberFromId(id: string): Promise<Barber> {
  try {
    const roster = await defaultBarbersPort.listActive()
    const hit = roster.find((row) => row.barber.id === id)
    if (hit !== undefined) return hit.barber
  } catch {
    // Fall through to shipped roster data.
  }
  return { id: asBarberId(id), name: id, ig: '' }
}

export const supabaseMyBookingsAdapter: MyBookingsPort = {
  async requestAccess(
    params: MyBookingsAccessRequestParams,
  ): Promise<MyBookingsAccessRequestResult> {
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'request_access',
        email: params.email,
        lang: params.lang,
        turnstileToken: params.turnstileToken,
      })
      if (failed) return { ok: false, error: 'system' }
      const parsed = parseWith(customerAccessRequestResponse, data)
      if (!parsed.ok) return { ok: false, error: 'system' }
      return parsed.value
    } catch {
      return { ok: false, error: 'system' }
    }
  },

  async exchangeAccess(accessCode: string): Promise<MyBookingsAccessExchangeResult> {
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'exchange_access',
        accessCode,
      })
      if (failed) return { ok: false, error: 'system' }
      const parsed = parseWith(customerAccessExchangeResponse, data)
      if (!parsed.ok) return { ok: false, error: 'system' }
      if (!parsed.value.ok) return { ok: false, error: parsed.value.error }
      rememberCustomerAccessToken(parsed.value.access_token)
      return { ok: true, accessToken: parsed.value.access_token }
    } catch {
      return { ok: false, error: 'system' }
    }
  },

  async list(params: MyBookingsListParams): Promise<MyBookingsResult> {
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'list',
        accessToken: params.accessToken,
      })
      if (failed) return { ok: false, error: 'system' }
      const parsed = parseWith(listCustomerBookingsResponse, data)
      if (!parsed.ok) return { ok: false, error: 'system' }
      if (!parsed.value.ok) {
        if (parsed.value.error === 'access_denied') forgetCustomerAccessToken(params.accessToken)
        return { ok: false, error: parsed.value.error }
      }

      rememberPhone(parsed.value.phone)

      const sep = myBookingsStrings(params.lang).atSep
      const bookings: MyBooking[] = []
      for (const row of parsed.value.bookings) {
        const start = new Date(row.start_at)
        bookings.push({
          id: row.id,
          barber: await barberFromId(row.barber_id),
          serviceName: row.service_name,
          price: row.price,
          durationMin: row.duration_min,
          start,
          whenLabel: formatRowLabel(params.lang, stockholmWallClockDate(start), sep),
        })
      }
      return { ok: true, bookings: splitByTime(bookings, new Date()) }
    } catch {
      return { ok: false, error: 'system' }
    }
  },

  async cancel(booking: MyBooking, accessToken: string): Promise<MyCancelResult> {
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'cancel',
        bookingId: booking.id,
        accessToken,
      })
      if (failed) return { ok: false, error: 'system' }
      const parsed = parseWith(customerBookingCancelResponse, data)
      if (!parsed.ok) return { ok: false, error: 'system' }
      if (!parsed.value.ok && parsed.value.error === 'access_denied') {
        forgetCustomerAccessToken(accessToken)
      }
      return parsed.value.ok
        ? { ok: true, id: booking.id }
        : { ok: false, error: parsed.value.error }
    } catch {
      return { ok: false, error: 'system' }
    }
  },
}
