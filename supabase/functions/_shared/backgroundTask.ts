/** Supabase's native lifetime hook; the durable database queue still owns retries and completion. */
declare const EdgeRuntime: { waitUntil?: (task: Promise<unknown>) => void }

export function retainTaskUntilSettled<T>(task: Promise<T>): Promise<T> {
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
    // Keep work alive if pg_net or another caller disconnects. Preserve the original HTTP result.
    // Handle rejection on the lifetime observer; the returned promise still exposes the failure.
    EdgeRuntime.waitUntil(
      task.then(
        () => undefined,
        () => undefined,
      ),
    )
  }
  return task
}
