import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { CmsPage } from './cms.ts'

type Node = DefaultTreeAdapterMap['node']

/** Most bodies never name the old shell. Parse only candidates so comments and quoted attribute
 * values cannot impersonate an actual shell element. HTML ids remain case-sensitive. */
function hasFrozenShell(html: string): boolean {
  if (!html.includes('cms-site-shell')) return false
  const shell = (node: Node): boolean =>
    ('tagName' in node &&
      node.attrs.some((item) => item.name === 'id' && item.value === 'cms-site-shell')) ||
    ('childNodes' in node && node.childNodes.some(shell))
  return shell(parseFragment(html))
}

/** A created page an earlier Studio stored with its own frozen header copy. The Studio migrates it
 * when it takes the document in (dropFrozenChrome); cms-studio refuses to publish it
 * (validateNoFrozenSitePages). The explicit legacy flag avoids inspecting either variant. */
export const isFrozenSitePage = (page: CmsPage): boolean =>
  page.layout === 'independent' ||
  hasFrozenShell(page.content.sv.html) ||
  hasFrozenShell(page.content.en.html)
