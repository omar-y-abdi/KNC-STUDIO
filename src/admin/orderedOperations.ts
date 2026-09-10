// A view can unmount or revisit a barber while its write still runs. Keep ordering outside the
// component: a returning view must read after that write, before enabling another mutation.
const pending = new Map<string, Promise<void>>()

export function orderedAdminOperation<T>(
  resource: string,
  operation: () => Promise<T>,
): Promise<T> {
  const result = (pending.get(resource) ?? Promise.resolve()).then(operation)
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
