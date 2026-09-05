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
      readonly start_at: string
      readonly end_at: string
      readonly refresh_token: string | null
      readonly calendar_id: string | null
      readonly google_event_id: string | null
      readonly mapped_barber_id?: string | null
      readonly mapped_refresh_token?: string | null
      readonly mapped_calendar_id?: string | null
      readonly mapped_google_event_id?: string | null
    })
  | (DispatchBase & {
      readonly action_type: 'calendar_event_delete'
      readonly booking_id: string
      readonly barber_id: string
      readonly google_event_id: string
      readonly refresh_token: string | null
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
  ): Promise<{
    readonly data: unknown
    readonly error: { readonly code?: string; readonly message?: string } | null
  }>
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

/** The only safe reason for a new Edge worker to use the pre-migration generic dispatcher. */
export function isMissingCalendarDispatcherError(
  error: { readonly code?: string; readonly message?: string } | null,
): boolean {
  if (error === null) return false
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /calendar_external_action_for_dispatch.*(does not exist|not found|could not find)/i.test(
      error.message ?? '',
    )
  )
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

interface CalendarBookingSource {
  readonly barber_id: string
  readonly service_name: string
  readonly customer_name: string
  readonly phone: string | null
  readonly email: string | null
  readonly start_at: string
  readonly end_at: string
  readonly refresh_token: string | null
  readonly calendar_id: string | null
  readonly google_event_id: string | null
  readonly mapped_barber_id: string | null
  readonly mapped_refresh_token: string | null
  readonly mapped_calendar_id: string | null
  readonly mapped_google_event_id: string | null
}

function optionalNullableNonEmpty(value: unknown): boolean {
  return value === undefined || value === null || nonEmpty(value)
}

function parseCalendarBookingSource(value: unknown): CalendarBookingSource | null {
  if (
    !isRecord(value) ||
    value.status !== 'confirmed' ||
    !nonEmpty(value.barber_id) ||
    !nonEmpty(value.service_name) ||
    !nonEmpty(value.customer_name) ||
    (value.phone !== null && typeof value.phone !== 'string') ||
    (value.email !== null && !nonEmpty(value.email)) ||
    !nonEmpty(value.start_at) ||
    !nonEmpty(value.end_at) ||
    (value.refresh_token !== null && !nonEmpty(value.refresh_token)) ||
    (value.calendar_id !== null && !nonEmpty(value.calendar_id)) ||
    (value.google_event_id !== null && !nonEmpty(value.google_event_id)) ||
    !optionalNullableNonEmpty(value.mapped_barber_id) ||
    !optionalNullableNonEmpty(value.mapped_refresh_token) ||
    !optionalNullableNonEmpty(value.mapped_calendar_id) ||
    !optionalNullableNonEmpty(value.mapped_google_event_id)
  ) {
    return null
  }

  return {
    barber_id: value.barber_id,
    service_name: value.service_name,
    customer_name: value.customer_name,
    phone: value.phone === null ? null : (value.phone as string),
    email: value.email,
    start_at: value.start_at,
    end_at: value.end_at,
    refresh_token: value.refresh_token === null ? null : (value.refresh_token as string),
    calendar_id: value.calendar_id === null ? null : (value.calendar_id as string),
    google_event_id: value.google_event_id === null ? null : (value.google_event_id as string),
    mapped_barber_id: typeof value.mapped_barber_id === 'string' ? value.mapped_barber_id : null,
    mapped_refresh_token:
      typeof value.mapped_refresh_token === 'string' ? value.mapped_refresh_token : null,
    mapped_calendar_id:
      typeof value.mapped_calendar_id === 'string' ? value.mapped_calendar_id : null,
    mapped_google_event_id:
      typeof value.mapped_google_event_id === 'string' ? value.mapped_google_event_id : null,
  }
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
    nonEmpty(value.start_at) &&
    nonEmpty(value.end_at) &&
    (value.refresh_token === null || nonEmpty(value.refresh_token)) &&
    (value.calendar_id === null || nonEmpty(value.calendar_id)) &&
    (value.google_event_id === null || typeof value.google_event_id === 'string') &&
    optionalNullableNonEmpty(value.mapped_barber_id) &&
    optionalNullableNonEmpty(value.mapped_refresh_token) &&
    optionalNullableNonEmpty(value.mapped_calendar_id) &&
    optionalNullableNonEmpty(value.mapped_google_event_id)
  ) {
    return {
      ...base,
      action_type: value.action_type,
      booking_id: value.booking_id,
      barber_id: value.barber_id,
      service_name: value.service_name,
      customer_name: value.customer_name,
      phone: value.phone === null ? null : (value.phone as string),
      start_at: value.start_at,
      end_at: value.end_at,
      refresh_token: value.refresh_token === null ? null : (value.refresh_token as string),
      calendar_id: value.calendar_id === null ? null : (value.calendar_id as string),
      google_event_id: value.google_event_id === null ? null : (value.google_event_id as string),
      mapped_barber_id: typeof value.mapped_barber_id === 'string' ? value.mapped_barber_id : null,
      mapped_refresh_token:
        typeof value.mapped_refresh_token === 'string' ? value.mapped_refresh_token : null,
      mapped_calendar_id:
        typeof value.mapped_calendar_id === 'string' ? value.mapped_calendar_id : null,
      mapped_google_event_id:
        typeof value.mapped_google_event_id === 'string' ? value.mapped_google_event_id : null,
    }
  }

  if (
    value.action_type === 'calendar_event_delete' &&
    isUuid(value.booking_id) &&
    nonEmpty(value.barber_id) &&
    nonEmpty(value.google_event_id) &&
    (value.refresh_token === null || nonEmpty(value.refresh_token)) &&
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
    nonEmpty(value.email) &&
    (value.lang === 'sv' || value.lang === 'en') &&
    isUuid(value.challenge_id) &&
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

interface CalendarEventIdentity {
  readonly bookingId: string
  readonly barberId: string
  readonly calendarId: string
  readonly googleEventId: string
}

function mappedCalendarEvent(
  source: CalendarBookingSource,
  bookingId: string,
): CalendarEventIdentity | null {
  if (
    !nonEmpty(source.mapped_barber_id) ||
    !nonEmpty(source.mapped_calendar_id) ||
    !nonEmpty(source.mapped_google_event_id)
  ) {
    return null
  }
  return {
    bookingId,
    barberId: source.mapped_barber_id,
    calendarId: source.mapped_calendar_id,
    googleEventId: source.mapped_google_event_id,
  }
}

function targetCalendarEvent(
  source: CalendarBookingSource,
  bookingId: string,
): CalendarEventIdentity | null {
  if (
    !nonEmpty(source.barber_id) ||
    !nonEmpty(source.calendar_id) ||
    !nonEmpty(source.google_event_id)
  ) {
    return null
  }
  return {
    bookingId,
    barberId: source.barber_id,
    calendarId: source.calendar_id,
    googleEventId: source.google_event_id,
  }
}

async function recordCalendarEventIfCurrent(
  bookingId: string,
  barberId: string,
  calendarId: string,
  service: ExternalActionService,
  googleEventIdValue: string,
): Promise<boolean> {
  const recorded = await service.rpc('calendar_record_event_if_current', {
    p_booking_id: bookingId,
    p_barber_id: barberId,
    p_calendar_id: calendarId,
    p_google_event_id: googleEventIdValue,
  })
  if (recorded.error !== null) {
    throw new ExternalActionError(
      'calendar_record_failed',
      recorded.error.message ?? 'Calendar mapping write failed',
    )
  }
  return recorded.data === true
}

async function queueCalendarEventDeletion(
  identity: CalendarEventIdentity,
  service: ExternalActionService,
): Promise<void> {
  let queued: Awaited<ReturnType<ExternalActionService['rpc']>>
  try {
    queued = await service.rpc('calendar_queue_event_deletion_for_identity', {
      p_booking_id: identity.bookingId,
      p_barber_id: identity.barberId,
      p_calendar_id: identity.calendarId,
      p_google_event_id: identity.googleEventId,
    })
  } catch (error) {
    throw new ExternalActionError(
      'calendar_orphan_cleanup_failed',
      error instanceof Error ? error.message : 'Calendar orphan cleanup queue failed',
    )
  }
  if (queued.error !== null) {
    throw new ExternalActionError(
      'calendar_orphan_cleanup_failed',
      queued.error.message ?? 'Calendar orphan cleanup queue failed',
    )
  }
}

async function compensateUnrecordedCalendarEvent(
  accessToken: string,
  identity: CalendarEventIdentity,
  service: ExternalActionService,
): Promise<void> {
  try {
    await deleteEvent(accessToken, identity.calendarId, identity.googleEventId)
  } catch (error) {
    await queueCalendarEventDeletion(identity, service)
    throw new ExternalActionError(
      'calendar_orphan_cleanup_failed',
      error instanceof Error ? error.message : 'Calendar orphan cleanup failed',
    )
  }
}

async function loadCalendarBookingSource(
  bookingId: string,
  service: ExternalActionService,
): Promise<CalendarBookingSource | null> {
  let source: Awaited<ReturnType<ExternalActionService['rpc']>>
  try {
    source = await service.rpc('calendar_sync_source', { p_booking_id: bookingId })
  } catch (error) {
    throw new ExternalActionError(
      'calendar_source_failed',
      error instanceof Error ? error.message : 'Calendar booking source failed',
    )
  }
  if (source.error !== null) {
    throw new ExternalActionError(
      'calendar_source_failed',
      source.error.message ?? 'Calendar booking source failed',
    )
  }
  return parseCalendarBookingSource(source.data)
}

async function forgetMappedCalendarEvent(
  bookingId: string,
  mapped: CalendarEventIdentity,
  source: CalendarBookingSource,
  service: ExternalActionService,
  runtime: ExternalActionRuntime,
): Promise<boolean> {
  if (!source.mapped_refresh_token) {
    throw new ExternalActionError(
      'calendar_authorization_required',
      'The old barber Calendar credential is unavailable for cleanup',
      false,
    )
  }
  if (!runtime.googleClientId || !runtime.googleClientSecret) {
    throw new ExternalActionError('not_configured', 'Google OAuth runtime is not configured')
  }

  const accessToken = await refreshAccessToken(
    source.mapped_refresh_token,
    runtime.googleClientId,
    runtime.googleClientSecret,
  )
  await deleteEvent(accessToken, mapped.calendarId, mapped.googleEventId)
  const forgotten = await service.rpc('calendar_forget_event_if_matches', {
    p_booking_id: bookingId,
    p_barber_id: mapped.barberId,
    p_calendar_id: mapped.calendarId,
    p_google_event_id: mapped.googleEventId,
  })
  if (forgotten.error !== null) {
    throw new ExternalActionError(
      'calendar_forget_failed',
      forgotten.error.message ?? 'Calendar mapping cleanup failed',
    )
  }
  return forgotten.data === true
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
      try {
        let source = await loadCalendarBookingSource(action.booking_id, service)
        if (source === null) return

        // A bounded loop handles the two races that matter here: another worker can win the old-map
        // delete CAS, or it can win the destination-map CAS after Google has accepted our write.
        for (let attempt = 0; attempt < 3; attempt++) {
          const mapped = mappedCalendarEvent(source, action.booking_id)
          const targetAvailable = nonEmpty(source.refresh_token) && nonEmpty(source.calendar_id)
          const targetEvent = targetCalendarEvent(source, action.booking_id)
          const mappingIsTarget =
            mapped !== null &&
            mapped.barberId === source.barber_id &&
            mapped.calendarId === source.calendar_id &&
            mapped.googleEventId === source.google_event_id

          if (mapped !== null && (!targetAvailable || !mappingIsTarget)) {
            const forgotten = await forgetMappedCalendarEvent(
              action.booking_id,
              mapped,
              source,
              service,
              runtime,
            )
            // A false exact delete means another writer changed the mapping.  Re-read before doing
            // anything at the destination; never overwrite the winner with this worker's event.
            source = await loadCalendarBookingSource(action.booking_id, service)
            if (source === null) return
            if (!forgotten) continue
            continue
          }

          // An unlinked destination is a valid no-op only after any old mapped event has been
          // deleted.  It must never create a replacement or write a null credential.
          if (!targetAvailable) return
          const refreshToken = source.refresh_token
          const calendarId = source.calendar_id
          if (refreshToken === null || calendarId === null) return
          if (!runtime.googleClientId || !runtime.googleClientSecret) {
            throw new ExternalActionError(
              'not_configured',
              'Google OAuth runtime is not configured',
            )
          }

          const event = buildEvent(source)
          const accessToken = await refreshAccessToken(
            refreshToken,
            runtime.googleClientId,
            runtime.googleClientSecret,
          )
          let eventId = targetEvent?.googleEventId ?? null
          if (eventId !== null) {
            const patched = await patchEvent(accessToken, calendarId, eventId, event)
            if (!patched) eventId = null
          }
          if (eventId === null) {
            eventId = await insertEvent(
              accessToken,
              calendarId,
              googleEventId(action.booking_id),
              event,
            )
          }

          let recorded: boolean
          try {
            recorded = await recordCalendarEventIfCurrent(
              action.booking_id,
              source.barber_id,
              calendarId,
              service,
              eventId,
            )
          } catch (error) {
            if (error instanceof ExternalActionError && error.code === 'calendar_record_failed') {
              await compensateUnrecordedCalendarEvent(
                accessToken,
                {
                  bookingId: action.booking_id,
                  barberId: source.barber_id,
                  calendarId,
                  googleEventId: eventId,
                },
                service,
              )
            }
            throw error
          }

          if (recorded) return

          await compensateUnrecordedCalendarEvent(
            accessToken,
            {
              bookingId: action.booking_id,
              barberId: source.barber_id,
              calendarId,
              googleEventId: eventId,
            },
            service,
          )
          source = await loadCalendarBookingSource(action.booking_id, service)
          if (source === null) return
        }
        throw new ExternalActionError('calendar_sync_race', 'Calendar mapping changed during sync')
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
      if (!action.refresh_token) {
        throw new ExternalActionError(
          'calendar_authorization_required',
          'The old barber Calendar credential is unavailable for cleanup',
          false,
        )
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
      const forgotten = await service.rpc('calendar_forget_event_if_matches', {
        p_booking_id: action.booking_id,
        p_barber_id: action.barber_id,
        p_calendar_id: action.calendar_id,
        p_google_event_id: action.google_event_id,
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
