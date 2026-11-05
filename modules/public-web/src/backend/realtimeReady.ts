export function isPostgresChangesReady(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const message = payload as Record<string, unknown>
  return message['extension'] === 'postgres_changes' && message['status'] === 'ok'
}
