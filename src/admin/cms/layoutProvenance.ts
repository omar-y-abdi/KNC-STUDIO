import type { CmsDocument } from '../../../shared/cms'
import { layoutResourceKey } from './captureResourceLayouts'

// Never a resource key, which is a JSON array: such layouts are stale until captured again.
const UNKNOWN = ''

/** Which resource data each draft document's Home/About layouts were captured for. The Worker
 * serves the stored layouts as first paint, so Publicera captures them again while they are stale.
 * A document first encountered inherits its then-current base's layouts; that source must stay
 * fixed when publication advances the base and Undo returns an older document. */
export class LayoutProvenance {
  private readonly source = new WeakMap<CmsDocument, string>()

  private sourceKey(document: CmsDocument, base: CmsDocument): string {
    let key = this.source.get(document)
    if (key === undefined) {
      key = layoutResourceKey(base)
      this.source.set(document, key)
    }
    return key
  }

  /** `next` keeps the layouts of `previous`: an edit, or resource data whose capture failed. */
  follow(previous: CmsDocument, next: CmsDocument, base: CmsDocument): void {
    // Record the previous snapshot too: Undo can return it after the base has changed.
    this.source.set(next, this.sourceKey(previous, base))
  }

  /** `document`'s layouts were captured for the resource data of `resources`. */
  captured(document: CmsDocument, resources: CmsDocument = document): void {
    this.source.set(document, layoutResourceKey(resources))
  }

  /** `document`'s layouts may belong to other resource data, e.g. a backup that was stale. */
  unknown(document: CmsDocument): void {
    this.source.set(document, UNKNOWN)
  }

  /** A merge keeps each side's layouts, so they match only when every side was current and had
   * the merged resource data. */
  merged(document: CmsDocument, sides: { document: CmsDocument; stale: boolean }[]): void {
    const key = layoutResourceKey(document)
    if (sides.some((side) => side.stale || layoutResourceKey(side.document) !== key))
      this.unknown(document)
    else this.captured(document)
  }

  stale(document: CmsDocument, base: CmsDocument): boolean {
    return this.sourceKey(document, base) !== layoutResourceKey(document)
  }
}
