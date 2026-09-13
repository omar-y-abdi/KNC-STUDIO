import type { Lang } from '../i18n/index'
import type { CustomerEmailLinkResult, MyBooking, MyBookingsResult, MyCancelResult } from './domain'

export interface MyBookingsAccessRequestParams {
  readonly email: string
  readonly lang: Lang
  readonly turnstileToken: string
}

export type MyBookingsAccessRequestResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'failed_challenge' | 'rate_limited' | 'system' }

export type MyBookingsAccessExchangeResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly error: 'invalid' | 'cookies_disabled' | 'system' }

export interface MyBookingsListParams {
  readonly accessToken: string
  readonly lang: Lang
}

export interface MyBookingsPort {
  requestEmailLink(email: string, lang: Lang, sourceEmail: string): Promise<CustomerEmailLinkResult>
  confirmEmailLink(code: string): Promise<CustomerEmailLinkResult>
  requestAccess(params: MyBookingsAccessRequestParams): Promise<MyBookingsAccessRequestResult>
  exchangeAccess(accessCode: string): Promise<MyBookingsAccessExchangeResult>
  list(params: MyBookingsListParams): Promise<MyBookingsResult>
  cancel(booking: MyBooking, accessToken: string): Promise<MyCancelResult>
}
