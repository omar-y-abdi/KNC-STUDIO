import { invokePublicBookingAction } from '../../backend/publicBookingActions'
import {
  customerAccessExchangeResponse,
  customerAccessRequestResponse,
  customerBookingCancelResponse,
  listCustomerBookingsResponse,
  parseWith,
} from '../../backend/rpcSchemas'
import { asBarberId } from '../../booking/domain'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import { myBookingsStrings } from '../../i18n/index'
import type { MyBooking, MyBookingsResult, MyCancelResult } from '../domain'
import { formatRowLabel, splitByTime } from '../format'
import type {
  MyBookingsAccessExchangeResult,
  MyBookingsAccessRequestParams,
  MyBookingsAccessRequestResult,
  MyBookingsListParams,
  MyBookingsPort,
} from '../port'

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
      const session = await invokePublicBookingAction({ action: 'list' })
      if (session.failed) return { ok: false, error: 'system' }
      const confirmed = parseWith(listCustomerBookingsResponse, session.data)
      if (!confirmed.ok) return { ok: false, error: 'system' }
      if (
        !confirmed.value.ok ||
        confirmed.value.authority !== 'verified' ||
        confirmed.value.session_proof !== parsed.value.session_proof
      ) {
        return { ok: false, error: 'cookies_disabled' }
      }
      return { ok: true, accessToken: '' }
    } catch {
      return { ok: false, error: 'system' }
    }
  },

  async list(params: MyBookingsListParams): Promise<MyBookingsResult> {
    try {
      const { data, failed } = await invokePublicBookingAction(
        params.accessToken === ''
          ? { action: 'list' }
          : { action: 'list', accessToken: params.accessToken },
      )
      if (failed) return { ok: false, error: 'system' }
      const parsed = parseWith(listCustomerBookingsResponse, data)
      if (!parsed.ok) return { ok: false, error: 'system' }
      if (!parsed.value.ok) {
        return { ok: false, error: parsed.value.error }
      }

      // Prove the browser retained the HttpOnly cookie before discarding the email credential.
      if (params.accessToken !== '') {
        if (parsed.value.authority !== 'verified') return { ok: false, error: 'access_denied' }
        const session = await invokePublicBookingAction({ action: 'list' })
        if (session.failed) return { ok: false, error: 'system' }
        const confirmed = parseWith(listCustomerBookingsResponse, session.data)
        if (!confirmed.ok) return { ok: false, error: 'system' }
        if (
          !confirmed.value.ok ||
          confirmed.value.authority !== 'verified' ||
          confirmed.value.session_proof !== parsed.value.session_proof
        ) {
          return { ok: false, error: 'cookies_disabled' }
        }
      }

      const sep = myBookingsStrings(params.lang).atSep
      const bookings: MyBooking[] = []
      for (const row of parsed.value.bookings) {
        const start = new Date(row.start_at)
        bookings.push({
          id: row.id,
          barber: {
            id: asBarberId(row.barber_id),
            name: row.barber_name ?? row.barber_id,
            ig: '',
          },
          serviceName: row.service_name,
          price: row.price,
          durationMin: row.duration_min,
          start,
          whenLabel: formatRowLabel(params.lang, stockholmWallClockDate(start), sep),
        })
      }
      if (parsed.value.authority === 'device') {
        return { ok: true, authority: 'device', bookings: splitByTime(bookings, new Date()) }
      }
      return {
        ok: true,
        authority: 'verified',
        bookings: splitByTime(bookings, new Date()),
        profile: {
          name: parsed.value.name ?? '',
          phone: parsed.value.phone,
          email: parsed.value.email ?? '',
        },
      }
    } catch {
      return { ok: false, error: 'system' }
    }
  },

  async cancel(booking: MyBooking, accessToken: string): Promise<MyCancelResult> {
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'cancel',
        bookingId: booking.id,
        ...(accessToken === '' ? {} : { accessToken }),
      })
      if (failed) return { ok: false, error: 'system' }
      const parsed = parseWith(customerBookingCancelResponse, data)
      if (!parsed.ok) return { ok: false, error: 'system' }
      return parsed.value.ok
        ? { ok: true, id: booking.id }
        : { ok: false, error: parsed.value.error }
    } catch {
      return { ok: false, error: 'system' }
    }
  },
}
