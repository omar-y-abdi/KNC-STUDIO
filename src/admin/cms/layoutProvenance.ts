import type { CmsDocument } from '../../../shared/cms'
import { layoutResourceKey } from './captureResourceLayouts'

// Never a resource key, which is a JSON array: such layouts are stale until captured again.
const UNKNOWN = ''

/** Which resource data each draft document's Home/About layouts were captured for. The Worker
 * serves the stored layouts as first paint, so Publicera captures them again while they are stale.
 * A document recorded nowhere has its base's layouts, as a document loaded from the server has. */
export class LayoutProvenance {
  private readonly source = new WeakMap<CmsDocument, string>()

  /** `next` keeps the layouts of `previous`: an edit, or resource data whose capture failed. */
  follow(previous: CmsDocument, next: CmsDocument): void {
    const source = this.source.get(previous)
    if (source !== undefined && next !== previous) this.source.set(next, source)
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
  }

  stale(document: CmsDocument, base: CmsDocument): boolean {
    return (this.source.get(document) ?? layoutResourceKey(base)) !== layoutResourceKey(document)
  }
}
