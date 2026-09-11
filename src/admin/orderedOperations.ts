// A view can unmount or revisit a barber while its write still runs. Keep ordering outside the
// component: a returning view must read after that write, before enabling another mutation.
import { err, type AdminResult } from './types'

const pending = new Map<string, Promise<void>>()
let generation = 0

/** Keep in-flight ordering, but never start an old session's queued intent with new credentials. */
export function invalidateAdminOperations(): void {
  generation += 1
}

/** Multi-step Auth effects share the same lifetime as queued view mutations. */
export function captureAdminOperation(): () => boolean {
  const owner = generation
  return () => owner === generation
}

export function orderedAdminOperation<T>(
  resource: string,
  operation: () => Promise<AdminResult<T>>,
): Promise<AdminResult<T>> {
  const isCurrent = captureAdminOperation()
  const expired = (): AdminResult<T> => err('auth', 'Din session har gått ut. Logga in igen.')
  const result = (pending.get(resource) ?? Promise.resolve())
    .then(() => (isCurrent() ? operation() : expired()))
    .then((value) => (isCurrent() ? value : expired()))
  // A failed operation still releases its resource; its caller receives the original rejection.
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  pending.set(resource, settled)
  void settled.then(() => {
    if (pending.get(resource) === settled) pending.delete(resource)
  })
  return result
}
