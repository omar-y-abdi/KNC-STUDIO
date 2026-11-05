// Schedule non-critical hydration work after the first render while preserving a bounded fallback.
export function scheduleIdle(task: () => void, timeoutMs = 1500): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => task(), { timeout: timeoutMs })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(task, timeoutMs)
  return () => window.clearTimeout(id)
}
