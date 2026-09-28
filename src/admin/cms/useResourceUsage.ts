import { useEffect, useState } from 'preact/hooks'
import type { CmsDocument } from '../../../shared/cms'
import type { MarkupPolicy } from '../../../shared/cms-markup'
import type { ResourceUsageResult } from './resourceUsage.worker'

/** The resource panel remains interactive while the unchanged validator scans the draft. */
export function useResourceUsage(document: CmsDocument, policy: MarkupPolicy) {
  const [result, setResult] = useState<(ResourceUsageResult & { document: CmsDocument }) | null>(
    null,
  )
  useEffect(() => {
    let active = true
    let worker: Worker | undefined
    const finish = (value: ResourceUsageResult): void => {
      if (active) setResult({ document, ...value })
    }
    try {
      worker = new Worker(new URL('./resourceUsage.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<ResourceUsageResult>) => finish(event.data)
      worker.onerror = (event) => {
        event.preventDefault()
        finish({ index: null, error: event.message || 'Referenserna kunde inte läsas.' })
      }
      worker.postMessage({ document, policy })
    } catch (reason) {
      finish({
        index: null,
        error: reason instanceof Error ? reason.message : 'Referenserna kunde inte läsas.',
      })
    }
    return () => {
      active = false
      worker?.terminate()
    }
  }, [document, policy])
  // Never expose an index for an older draft, even before the replacement effect starts.
  return result?.document === document ? result : null
}
