import { err, type AdminResult } from '../types'

interface MediaGatewayMessages {
  readonly fallback: string
  readonly forbidden: string
  readonly validation: string
  readonly conflict?: string
}

/** Supabase FunctionsHttpError holds a Response in context; malformed errors remain transport errors. */
export function mediaGatewayError<T>(
  error: unknown,
  messages: MediaGatewayMessages,
): AdminResult<T> {
  const context =
    typeof error === 'object' && error !== null && 'context' in error ? error.context : null
  const status =
    typeof context === 'object' && context !== null && 'status' in context ? context.status : null
  if (status === 401) return err('auth', 'Din session har gått ut. Logga in igen.')
  if (status === 403) return err('forbidden', messages.forbidden)
  if (status === 400 || status === 413 || status === 422)
    return err('validation', messages.validation)
  if (status === 409 && messages.conflict !== undefined) return err('validation', messages.conflict)
  return err('network', messages.fallback)
}
