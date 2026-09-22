// Fault-injection host for the real resource component. All network I/O is intercepted by Playwright.
import { render } from 'preact'
import type { CmsAsset, CmsDocument } from '../../shared/cms'
import { CmsResources } from '../../src/admin/cms/Resources'
import '../../src/admin/cms/studio.css'

type Update<T> = T | ((current: T) => T)
let model: { assets: CmsAsset[]; document: CmsDocument; error: string }

const setAssets = (next: Update<CmsAsset[]>): void => {
  model.assets = typeof next === 'function' ? next(model.assets) : next
  draw()
}
const setDocument = (next: Update<CmsDocument>): void => {
  model.document = typeof next === 'function' ? next(model.document) : next
  draw()
}
const onError = (message: string): void => {
  model.error = message
  draw()
}
function draw(): void {
  const root = document.getElementById('root')
  if (!root) throw new Error('Resource harness root is missing')
  render(
    <div class="knc-cms-studio">
      <CmsResources
        assets={model.assets}
        document={model.document}
        onAssets={setAssets}
        onDocument={setDocument}
        onError={onError}
      />
      <output data-review-error>{model.error}</output>
    </div>,
    root,
  )
}
export function mountResources(assets: CmsAsset[], document: CmsDocument): void {
  model = { assets, document, error: '' }
  draw()
}
export function changeBusinessName(name: string): void {
  setDocument((current) => ({ ...current, settings: { ...current.settings, business_name: name } }))
}
export function snapshot(): typeof model {
  return structuredClone(model)
}
