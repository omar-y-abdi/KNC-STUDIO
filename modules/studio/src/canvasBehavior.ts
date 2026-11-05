import type { Editor } from 'grapesjs'
import {
  mobileFold,
  mobileLayoutViewportHeight,
  paintMobileBrand,
  primeMobileFold,
} from '@bladeblend/public-web/mobile-layout'
import type { CmsScene } from '@bladeblend/public-web/preview'
import { SITE_THEME_DEFAULTS } from '@bladeblend/content-contracts/site-theme'
import type { CmsMode } from '@bladeblend/content-contracts/cms'

export function sceneVisibilityCss(scene: CmsScene, mode: CmsMode): string {
  const scenes = ['booking-options', 'booking-details', 'booking-confirmation', 'my-bookings-list']
  if (scene === 'my-bookings-list')
    return `body{background:var(--knc-background,${SITE_THEME_DEFAULTS[mode].background})}[data-knc-native]>[data-knc-surface]:not([data-knc-surface="${scene}"]){display:none!important}`
  const hideStoredStages = scenes
    .map((name) => `[data-knc-native]>[data-knc-surface="${name}"]{display:none!important}`)
    .join('')
  return scene === 'default'
    ? hideStoredStages
    : `body{background:var(--knc-background,${SITE_THEME_DEFAULTS[mode].background})}${hideStoredStages}`
}

/** DOM-only preview state: no scroll geometry or hidden-scene styles enter the editor model. */
export function canvasBehavior(editor: Editor, scene: CmsScene, mode: CmsMode): () => void {
  let dispose = (): void => undefined
  const attach = (): void => {
    dispose()
    const doc = editor.Canvas.getDocument()
    const win = doc?.defaultView
    if (!doc || !win) return
    const style = doc.createElement('style')
    style.id = 'cms-canvas-behavior'
    doc.head.appendChild(style)
    const visibility = sceneVisibilityCss(scene, mode)
    let frame = 0
    let previousRoot: HTMLElement | null = null
    let carrier: HTMLElement | null = null
    let headerCarrier: HTMLElement | null = null
    let primed = false
    let stopPriming = (): void => undefined
    const update = (): void => {
      frame = 0
      const root = doc.querySelector<HTMLElement>(
        '[data-knc-surface="mobile-home"], [data-knc-surface="mobile-booking"]',
      )
      const surface = root?.getAttribute('data-knc-surface') ?? 'mobile-home'
      const panel = root?.querySelector<HTMLElement>('[data-knc-fold="panel"]')
      if (
        root &&
        root.clientHeight > 0 &&
        (root !== previousRoot || (panel && panel.parentElement !== carrier))
      ) {
        stopPriming()
        if (headerCarrier) headerCarrier.replaceWith(...headerCarrier.childNodes)
        if (carrier) carrier.replaceWith(...carrier.childNodes)
        const entering = root !== previousRoot
        previousRoot = root
        carrier = doc.createElement('div')
        carrier.setAttribute('data-knc-fold', 'carrier')
        if (panel) {
          panel.parentNode?.insertBefore(carrier, panel)
          carrier.appendChild(panel)
          const hero = panel.querySelector<HTMLElement>(':scope > [data-knc-fold="hero"]')
          headerCarrier = doc.createElement('div')
          headerCarrier.setAttribute('data-knc-fold', 'header-carrier')
          if (hero) {
            const headerNodes = []
            for (let child = panel.firstChild; child && child !== hero; child = child.nextSibling)
              headerNodes.push(child)
            panel.insertBefore(headerCarrier, panel.firstChild)
            for (const child of headerNodes) headerCarrier.appendChild(child)
          }
        }
        primed = false
        stopPriming = primeMobileFold(root, (active) => {
          if (active === primed) return
          primed = active
          if (frame) win.cancelAnimationFrame(frame)
          update()
        })
        if (entering && surface === 'mobile-booking')
          root.scrollTop = mobileFold(Infinity, mobileLayoutViewportHeight(root)).collapse
      }
      if (panel && headerCarrier?.parentElement === panel) {
        const hero = panel.querySelector<HTMLElement>(':scope > [data-knc-fold="hero"]')
        if (hero && (panel.firstChild !== headerCarrier || headerCarrier.nextSibling !== hero)) {
          const prefix: ChildNode[] = []
          for (let child = panel.firstChild; child && child !== hero; child = child.nextSibling)
            prefix.push(...(child === headerCarrier ? [...headerCarrier.childNodes] : [child]))
          panel.insertBefore(headerCarrier, panel.firstChild)
          for (const child of prefix) headerCarrier.appendChild(child)
        }
      }
      const motion = mobileFold(
        root?.scrollTop ?? 0,
        root ? mobileLayoutViewportHeight(root) : win.innerHeight,
      )
      const pinned = primed || motion.collapse > 0
      const scope = `[data-knc-surface="${surface}"] [data-knc-fold=`
      const css =
        visibility +
        `${scope}"carrier"]{display:${pinned ? 'block' : 'contents'}!important;position:${pinned ? 'sticky' : 'static'}!important;top:calc(112px - 100dvh)!important;height:100dvh!important;z-index:10!important}` +
        `${scope}"header-carrier"]{display:${pinned ? 'block' : 'contents'}!important;position:${pinned ? 'sticky' : 'static'}!important;top:0!important;flex:none!important;z-index:10!important;background:inherit!important}` +
        `${scope}"panel"]{position:relative!important;transform:none!important;top:0!important;height:100dvh!important;overflow:clip!important;border-radius:${motion.compact ? '0 0 28px 28px' : '0'}!important}` +
        `${scope}"spacer"]{height:0!important}` +
        `${scope}"controls"]{margin-top:${motion.compact ? 24 : 0}px!important}` +
        `${scope}"mark"]{transition:none!important;transform-origin:50% 0!important}` +
        `${scope}"brand"]{position:relative!important;z-index:20!important;transform-origin:50% 0!important;pointer-events:none!important}` +
        `${scope}"return"]{display:${motion.compact ? 'flex' : 'none'}!important}` +
        `${scope}"hero"]{opacity:1!important;overflow:visible!important}`
      if (style.textContent !== css) {
        style.textContent = css
        editor.refresh()
      }
      if (root)
        paintMobileBrand(
          root,
          motion.collapse,
          mobileLayoutViewportHeight(root),
          win.matchMedia('(prefers-reduced-motion: reduce)').matches,
        )
    }
    const schedule = (): void => {
      if (!frame) frame = win.requestAnimationFrame(update)
    }
    doc.addEventListener('scroll', schedule, true)
    win.addEventListener('resize', schedule)
    editor.on('component:mount', schedule)
    update()
    dispose = () => {
      doc.removeEventListener('scroll', schedule, true)
      win.removeEventListener('resize', schedule)
      editor.off('component:mount', schedule)
      win.cancelAnimationFrame(frame)
      stopPriming()
      if (headerCarrier) headerCarrier.replaceWith(...headerCarrier.childNodes)
      if (carrier) carrier.replaceWith(...carrier.childNodes)
      style.remove()
    }
  }
  // Initial frame events precede Canvas selecting its document; editor load is the first usable document.
  editor.on('load canvas:frame:load:body', attach)
  attach()
  return () => {
    editor.off('load canvas:frame:load:body', attach)
    dispose()
  }
}
