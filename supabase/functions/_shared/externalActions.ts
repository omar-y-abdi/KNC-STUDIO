import {
  deleteEvent,
  isGoogleAuthorizationError,
  refreshAccessToken,
  revokeToken,
} from './calendar.ts'

export type StorageBucket = 'gallery' | 'barber-photos'

interface DispatchBase {
  readonly id: string
  readonly dispatch_token: string
}

export type ExternalAction =
  | (DispatchBase & {
      readonly action_type: 'superseded'
    })
  | (DispatchBase & {
      readonly action_type: 'storage_object_delete'
      readonly bucket: StorageBucket
      readonly path: string
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
      readonly action_type: 'auth_user_access_sync'
      readonly user_id: string
      readonly account_enabled: boolean
      readonly version: number
    })
  | (DispatchBase & {
      readonly action_type: 'auth_user_delete'
      readonly user_id: string
    })

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
    typeof value.path === 'string' &&
    value.path.length > 0
  ) {
    return { ...base, action_type: value.action_type, bucket: value.bucket, path: value.path }
  }

  if (
    value.action_type === 'calendar_event_delete' &&
    isUuid(value.booking_id) &&
    typeof value.barber_id === 'string' &&
    value.barber_id.length > 0 &&
    typeof value.google_event_id === 'string' &&
    value.google_event_id.length > 0 &&
    typeof value.refresh_token === 'string' &&
    value.refresh_token.length > 0 &&
    typeof value.calendar_id === 'string' &&
    value.calendar_id.length > 0
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
    typeof value.barber_id === 'string' &&
    value.barber_id.length > 0 &&
    typeof value.refresh_token === 'string' &&
    value.refresh_token.length > 0 &&
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
