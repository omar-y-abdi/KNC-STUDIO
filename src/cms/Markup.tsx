import { createElement, type JSX, type ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useMemo, useState } from 'preact/hooks'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { validateMarkup } from '../../shared/cms-markup'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets'
import { SUPABASE_URL } from '../backend/config'

type Node = DefaultTreeAdapterMap['node']
function vnode(node: Node, key: number): ComponentChildren {
  if ('value' in node) return node.value
  if (!('tagName' in node)) return null
  const props: Record<string, unknown> = { key }
  for (const attr of node.attrs) props[attr.name === 'class' ? 'className' : attr.name] = attr.value
  return createElement(node.tagName, props, ...node.childNodes.map(vnode))
}
export function CmsMarkup({
  html,
  css,
  label = 'Sidinnehåll',
}: {
  html: string
  css: string
  label?: string
}): JSX.Element {
  const [root, setRoot] = useState<ShadowRoot | null>(null)
  const result = useMemo(() => {
    try {
      const normalized = validateMarkup(html, css, {
        siteOrigin: window.location.origin,
        storageOrigin: new URL(SUPABASE_URL ?? 'https://unconfigured.invalid').origin,
        builtAssets: CMS_BUILT_ASSETS,
      })
      return { children: parseFragment(normalized.html).childNodes.map(vnode), error: null }
    } catch (error) {
      return {
        children: null,
        error: error instanceof Error ? error.message : 'Innehållet kan inte visas säkert.',
      }
    }
  }, [html, css])
  return (
    <div
      data-cms-authored
      aria-label={label}
      ref={(element) => {
        if (element && !element.shadowRoot) setRoot(element.attachShadow({ mode: 'open' }))
      }}
    >
      {root &&
        createPortal(
          result.error ? (
            <p role="alert">{result.error}</p>
          ) : (
            <>
              <style>{`:host{display:block;font:inherit;color:inherit}*{box-sizing:border-box}img{max-width:100%;height:auto}${css}`}</style>
              {result.children}
            </>
          ),
          root,
        )}
    </div>
  )
}
