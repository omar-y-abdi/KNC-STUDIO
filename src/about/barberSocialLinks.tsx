import { cloneElement, isValidElement, type ComponentChild, type JSX } from 'preact'
import { FOCUS_CLS } from '../ui/pseudo'

type Platform = 'instagram' | 'tiktok'

/** Keep authored copy intact; only explicit handles on a known platform become profile links. */
export function socialText(
  text: string,
  initialPlatform?: Platform,
  hidden = false,
): ComponentChild[] {
  const parts: ComponentChild[] = []
  let platform = initialPlatform
  let end = 0
  const tokens = /\b(?:instagram|insta|ig|tik\s?tok)\b|(?<![\w@])@[a-zA-Z0-9_][a-zA-Z0-9_.]*/gi
  for (const match of text.matchAll(tokens)) {
    const token = match[0].replace(/\.+$/, '')
    if (!token.startsWith('@')) {
      platform = /^tik/i.test(token) ? 'tiktok' : 'instagram'
      continue
    }
    if (!platform || token.includes('..')) continue
    const start = match.index
    parts.push(text.slice(end, start))
    const handle = token.slice(1)
    parts.push(
      <a
        key={start}
        href={
          platform === 'instagram'
            ? `https://www.instagram.com/${handle}/`
            : `https://www.tiktok.com/@${handle}`
        }
        target="_blank"
        rel="noopener noreferrer"
        class={FOCUS_CLS}
        tabIndex={hidden ? -1 : undefined}
        onClick={(event) => event.stopPropagation()}
        style={{ color: 'inherit', textUnderlineOffset: '3px' }}
      >
        {token}
      </a>,
    )
    end = start + token.length
  }
  parts.push(text.slice(end))
  return parts
}

/** Link the visible, projected copy after CMS owner edits. Source snapshots stay plain text, so
 * existing leaf identities and owner-authored biographies survive without duplicate old text. */
export function barberSocialLinks(tree: JSX.Element): JSX.Element {
  const visit = (
    child: ComponentChild,
    platform?: Platform,
    link = false,
    hidden = false,
  ): ComponentChild => {
    if (typeof child === 'string') return link ? socialText(child, platform, hidden) : child
    if (Array.isArray(child)) {
      if (link && child.every((item) => typeof item === 'string' || typeof item === 'number'))
        return socialText(child.join(''), platform, hidden)
      return child.map((item) => visit(item, platform, link, hidden))
    }
    if (!isValidElement(child)) return child
    const props = child.props as Record<string, unknown>
    if (child.type === 'a') return child
    const kind = props['data-barber-social']
    return cloneElement(
      child,
      {},
      visit(
        props['children'] as ComponentChild,
        kind === 'instagram' ? 'instagram' : platform,
        link || kind === 'instagram' || kind === 'bio',
        hidden || props['aria-hidden'] === true || props['aria-hidden'] === 'true',
      ),
    )
  }
  return visit(tree) as JSX.Element
}
