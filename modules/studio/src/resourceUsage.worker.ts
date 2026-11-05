import { resourceUsageIndex } from '@bladeblend/content-contracts/cms-resources'
import type { CmsDocument } from '@bladeblend/content-contracts/cms'
import type { MarkupPolicy } from '@bladeblend/content-contracts/cms-markup'

export interface ResourceUsageResult {
  index: Map<string, string[]> | null
  error: string | null
}

self.onmessage = (event: MessageEvent<{ document: CmsDocument; policy: MarkupPolicy }>): void => {
  let result: ResourceUsageResult
  try {
    result = { index: resourceUsageIndex(event.data.document, event.data.policy), error: null }
  } catch (reason) {
    result = {
      index: null,
      error: reason instanceof Error ? reason.message : 'Referenserna kunde inte läsas.',
    }
  }
  self.postMessage(result)
}
