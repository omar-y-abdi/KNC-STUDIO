import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  buildEvent,
  deleteEvent,
  GoogleHttpError,
  googleEventId,
  insertEvent,
  isGoogleAuthorizationError,
  isTransientGoogleError,
  patchEvent,
  refreshAccessToken,
  revokeToken,
} from './calendar.ts'
import {
  buildEmailMessage,
  defaultEmailTemplate,
  loadEmailBusiness,
  loadEmailTemplate,
  resendDeliveryFailureCode,
  sendViaResend,
} from './email.ts'
import { customerAccessUrl, decryptCustomerAccessToken } from './customerAccess.ts'

export type StorageBucket = 'gallery' | 'barber-photos'

type Language = 'sv' | 'en'

interface DispatchBase {
  readonly id: string
  readonly dispatch_token: string
}

export type ExternalAction =
  | (DispatchBase & { readonly action_type: 'superseded' })
  | (DispatchBase & {
      readonly action_type: 'storage_object_delete'
      readonly bucket: StorageBucket
      readonly path: string
    })
  | (DispatchBase & {
      readonly action_type: 'calendar_event_sync'
      readonly booking_id: string
      readonly barber_id: string
      readonly service_name: string
      readonly customer_name: string
      readonly phone: string | null
      readonly email: string | null
      readonly start_at: string
      readonly end_at: string
      readonly refresh_token: string
      readonly calendar_id: string
      readonly google_event_id: string | null
    })
  | (DispatchBase & {
      readonly action_type: 'calendar_event_delete'
      readonly booking_id: string
      readonly barber_id: string
      readonly google_event_id: string
      readonly refresh_token: string
      readonly calendar_id: string
    })
  | (DispatchBase & {
      readonly action_type: 'calendar_disconnect'
      readonly barber_id: string
      readonly refresh_token: string
      readonly ready: boolean
    })
  | (DispatchBase & {
      readonly action_type: 'customer_access_email_send'
      readonly challenge_id: string
      readonly email: string
      readonly lang: Language
      readonly token_ciphertext: string
    })
  | (DispatchBase & {
      readonly action_type: 'auth_user_access_sync'
      readonly user_id: string
      readonly account_enabled: boolean
      readonly version: number
    })
  | (DispatchBase & { readonly action_type: 'auth_user_delete'; readonly user_id: string })

export interface ExternalActionService {
  readonly storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ readonly error: { readonly message: string } | null }>
    }
  }
  readonly auth: {
    readonly admin: {
      updateUserById(
        userId: string,
        attributes: { readonly ban_duration: string },
      ): Promise<{ readonly error: AuthAdminError | null }>
      deleteUser(
        userId: string,
        shouldSoftDelete: boolean,
      ): Promise<{ readonly error: AuthAdminError | null }>
    }
  }
  rpc(
    name: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: { readonly message?: string } | null }>
}

interface AuthAdminError {
  readonly code?: string
  readonly status?: number
  readonly message?: string
}

export interface ExternalActionRuntime {
  readonly googleClientId: string | undefined
  readonly googleClientSecret: string | undefined
  readonly resendApiKey?: string | undefined
  readonly customerAccessHashSalt?: string | undefined
}

export class ExternalActionError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = true) {
    super(message)
    this.name = 'ExternalActionError'
    this.code = code
    this.retryable = retryable
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function customerAccessCiphertext(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 40 &&
    value.length <= 700 &&
    /^v1\.[A-Za-z0-9_-]+$/.test(value)
  )
}

function dispatchBase(row: Record<string, unknown>): DispatchBase | null {
  return isUuid(row.id) && isUuid(row.dispatch_token)
    ? { id: row.id, dispatch_token: row.dispatch_token }
    : null
}

export function parseExternalAction(value: unknown): ExternalAction | null {
  if (!isRecord(value)) return null
  const base = dispatchBase(value)
  if (base === null || typeof value.action_type !== 'string') return null

  if (value.superseded === true) return { ...base, action_type: 'superseded' }

  if (
    value.action_type === 'storage_object_delete' &&
    (value.bucket === 'gallery' || value.bucket === 'barber-photos') &&
    nonEmpty(value.path)
  ) {
    return { ...base, action_type: value.action_type, bucket: value.bucket, path: value.path }
  }

  if (
    value.action_type === 'calendar_event_sync' &&
    isUuid(value.booking_id) &&
    nonEmpty(value.barber_id) &&
    nonEmpty(value.service_name) &&
    nonEmpty(value.customer_name) &&
    (value.phone === null || typeof value.phone === 'string') &&
    (value.email === null || nonEmpty(value.email)) &&
    nonEmpty(value.start_at) &&
    nonEmpty(value.end_at) &&
    nonEmpty(value.refresh_token) &&
    nonEmpty(value.calendar_id) &&
    (value.google_event_id === null || typeof value.google_event_id === 'string')
  ) {
    return {
      ...base,
      action_type: value.action_type,
      booking_id: value.booking_id,
      barber_id: value.barber_id,
      service_name: value.service_name,
      customer_name: value.customer_name,
      phone: value.phone,
      email: value.email,
      start_at: value.start_at,
      end_at: value.end_at,
      refresh_token: value.refresh_token,
      calendar_id: value.calendar_id,
      google_event_id: value.google_event_id,
    }
  }

  if (
    value.action_type === 'calendar_event_delete' &&
    isUuid(value.booking_id) &&
    nonEmpty(value.barber_id) &&
    nonEmpty(value.google_event_id) &&
    nonEmpty(value.refresh_token) &&
    nonEmpty(value.calendar_id)
  ) {
    return {
      ...base,
      action_type: value.action_type,
      booking_id: value.booking_id,
      barber_id: value.barber_id,
      google_event_id: value.google_event_id,
      refresh_token: value.refresh_token,
      calendar_id: value.calendar_id,
    }
  }

  if (
    value.action_type === 'customer_access_email_send' &&
    isUuid(value.challenge_id) &&
    nonEmpty(value.email) &&
    (value.lang === 'sv' || value.lang === 'en') &&
    customerAccessCiphertext(value.token_ciphertext)
  ) {
    return {
      ...base,
      action_type: value.action_type,
      challenge_id: value.challenge_id,
      email: value.email,
      lang: value.lang,
      token_ciphertext: value.token_ciphertext,
    }
  }

  if (
    value.action_type === 'auth_user_access_sync' &&
    isUuid(value.user_id) &&
    typeof value.account_enabled === 'boolean' &&
    typeof value.version === 'number' &&
    Number.isSafeInteger(value.version) &&
    value.version >= 0
  ) {
    return {
      ...base,
      action_type: value.action_type,
      user_id: value.user_id,
      account_enabled: value.account_enabled,
      version: value.version,
    }
  }

  if (
    value.action_type === 'calendar_disconnect' &&
    nonEmpty(value.barber_id) &&
    nonEmpty(value.refresh_token) &&
    typeof value.ready === 'boolean'
  ) {
    return {
      ...base,
      action_type: value.action_type,
      barber_id: value.barber_id,
      refresh_token: value.refresh_token,
      ready: value.ready,
    }
  }

  if (value.action_type === 'auth_user_delete' && isUuid(value.user_id)) {
    return { ...base, action_type: value.action_type, user_id: value.user_id }
  }

  return null
}

function authUserAlreadyMissing(error: AuthAdminError): boolean {
  return error.status === 404 || error.code === 'user_not_found'
}

async function recordCalendarEvent(
  action: Extract<ExternalAction, { action_type: 'calendar_event_sync' }>,
  service: ExternalActionService,
  googleEventIdValue: string,
): Promise<void> {
  const recorded = await service.rpc('calendar_record_event', {
    p_booking_id: action.booking_id,
    p_barber_id: action.barber_id,
    p_google_event_id: googleEventIdValue,
  })
  if (recorded.error !== null) {
    throw new ExternalActionError(
      'calendar_record_failed',
      recorded.error.message ?? 'Calendar mapping write failed',
    )
  }
}

export async function executeExternalAction(
  action: ExternalAction,
  service: ExternalActionService,
  runtime: ExternalActionRuntime,
): Promise<void> {
  switch (action.action_type) {
    case 'superseded':
      return
    case 'storage_object_delete': {
      const removed = await service.storage.from(action.bucket).remove([action.path])
      if (removed.error !== null) {
        throw new ExternalActionError('storage_failed', removed.error.message)
      }
      return
    }
    case 'calendar_event_sync': {
      if (!runtime.googleClientId || !runtime.googleClientSecret) {
        throw new ExternalActionError('not_configured', 'Google OAuth runtime is not configured')
      }
      try {
        const accessToken = await refreshAccessToken(
          action.refresh_token,
          runtime.googleClientId,
          runtime.googleClientSecret,
        )
        const event = buildEvent(action)
        if (action.google_event_id !== null) {
          const patched = await patchEvent(
            accessToken,
            action.calendar_id,
            action.google_event_id,
            event,
          )
          if (patched) {
            await recordCalendarEvent(action, service, action.google_event_id)
            return
          }
        }
        const eventId = await insertEvent(
          accessToken,
          action.calendar_id,
          googleEventId(action.booking_id),
          event,
        )
        await recordCalendarEvent(action, service, eventId)
      } catch (error) {
        if (error instanceof ExternalActionError) throw error
        const authorizationRequired = isGoogleAuthorizationError(error)
        const retryable =
          authorizationRequired || error instanceof GoogleHttpError
            ? !authorizationRequired && isTransientGoogleError(error)
            : true
        throw new ExternalActionError(
          authorizationRequired ? 'calendar_authorization_required' : 'calendar_sync_failed',
          error instanceof Error ? error.message : 'Calendar synchronization failed',
          retryable,
        )
      }
      return
    }
    case 'calendar_event_delete': {
      if (!runtime.googleClientId || !runtime.googleClientSecret) {
        throw new ExternalActionError('not_configured', 'Google OAuth runtime is not configured')
      }
      try {
        const accessToken = await refreshAccessToken(
          action.refresh_token,
          runtime.googleClientId,
          runtime.googleClientSecret,
        )
        await deleteEvent(accessToken, action.calendar_id, action.google_event_id)
      } catch (error) {
        const authorizationRequired = isGoogleAuthorizationError(error)
        throw new ExternalActionError(
          authorizationRequired ? 'calendar_authorization_required' : 'calendar_delete_failed',
          error instanceof Error ? error.message : 'Calendar deletion failed',
          !authorizationRequired,
        )
      }
      const forgotten = await service.rpc('calendar_forget_event', {
        p_booking_id: action.booking_id,
      })
      if (forgotten.error !== null) {
        throw new ExternalActionError(
          'calendar_forget_failed',
          forgotten.error.message ?? 'Calendar mapping cleanup failed',
        )
      }
      return
    }
    case 'calendar_disconnect': {
      if (!action.ready) {
        throw new ExternalActionError(
          'calendar_events_pending',
          'Calendar event deletions are still pending',
        )
      }
      if (!(await revokeToken(action.refresh_token))) {
        throw new ExternalActionError('calendar_revoke_failed', 'Google token revocation failed')
      }
      const deleted = await service.rpc('calendar_delete_token', {
        p_barber_id: action.barber_id,
      })
      if (deleted.error !== null) {
        throw new ExternalActionError(
          'calendar_disconnect_failed',
          deleted.error.message ?? 'Calendar token cleanup failed',
        )
      }
      return
    }
    case 'customer_access_email_send': {
      if (!runtime.resendApiKey || !runtime.customerAccessHashSalt) {
        throw new ExternalActionError('not_configured', 'Resend runtime is not configured')
      }
      try {
        const emailClient = service as unknown as SupabaseClient
        const business = await loadEmailBusiness(emailClient)
        const copy = await loadEmailTemplate(emailClient, 'customer_booking_access', action.lang)
        const accessCode = await decryptCustomerAccessToken(
          action.token_ciphertext,
          runtime.customerAccessHashSalt,
        )
        if (accessCode === null) {
          throw new ExternalActionError(
            'customer_access_token_decrypt_failed',
            'Customer access token could not be decrypted',
            false,
          )
        }
        const message = buildEmailMessage({
          to: action.email,
          lang: action.lang,
          copy: copy ?? defaultEmailTemplate('customer_booking_access', action.lang),
          ctaHref: customerAccessUrl(accessCode),
          business,
        })
        await sendViaResend(message, runtime.resendApiKey, `customer-booking-access/${action.id}`)
        const consumed = await service.rpc('consume_customer_access_email_challenge', {
          p_challenge_id: action.challenge_id,
        })
        if (consumed.error !== null || consumed.data !== true) {
          throw new ExternalActionError(
            'customer_access_challenge_consume_failed',
            'Customer access challenge could not be consumed',
          )
        }
      } catch (error) {
        if (error instanceof ExternalActionError) throw error
        const failureCode = resendDeliveryFailureCode(error)
        throw new ExternalActionError(
          failureCode,
          error instanceof Error ? error.message : 'Customer access email failed',
          failureCode !== 'send_failed_permanent',
        )
      }
      return
    }
    case 'auth_user_access_sync': {
      const updated = await service.auth.admin.updateUserById(action.user_id, {
        ban_duration: action.account_enabled ? 'none' : '876000h',
      })
      if (updated.error !== null) {
        throw new ExternalActionError(
          'auth_sync_failed',
          updated.error.message ?? 'Auth account state update failed',
        )
      }
      return
    }
    case 'auth_user_delete': {
      const deleted = await service.auth.admin.deleteUser(action.user_id, true)
      if (deleted.error !== null && !authUserAlreadyMissing(deleted.error)) {
        throw new ExternalActionError(
          'auth_delete_failed',
          deleted.error.message ?? 'Auth account deletion failed',
        )
      }
    }
  }
}
