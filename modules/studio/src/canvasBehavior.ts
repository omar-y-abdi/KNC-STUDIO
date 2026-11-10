import type { Editor } from 'grapesjs'
import {
  mobileFold,
  observeMobileBrandGeometry,
  mobileBrandMotion,
  mobileLayoutViewportHeight,
  paintMobileBrand,
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
    let stopBrandGeometry = (): void => undefined
    let brandRoot: HTMLElement | null = null
    let brandGeometryDirty = false
    const update = (): void => {
      frame = 0
      const root = doc.querySelector<HTMLElement>(
        '[data-knc-surface="mobile-home"], [data-knc-surface="mobile-booking"]',
      )
      const surface = root?.getAttribute('data-knc-surface') ?? 'mobile-home'
      if (root && root !== previousRoot && root.clientHeight > 0) {
        previousRoot = root
        // A captured booking opens at its content, like a direct booking URL on the public site.
        if (surface === 'mobile-booking')
          root.scrollTop = mobileFold(Infinity, mobileLayoutViewportHeight(root)).collapse
      }
      const height = root ? mobileLayoutViewportHeight(root) : win.innerHeight
      const motion = mobileFold(root?.scrollTop ?? 0, height)
      const brand = mobileBrandMotion(motion.collapse, height)
      const scope = `[data-knc-surface="${surface}"] [data-knc-fold=`
      const css =
        visibility +
        `${scope}"panel"]{position:sticky!important;top:0!important;height:calc(100dvh - ${motion.collapse}px)!important;transition:none!important;border-radius:${motion.compact ? '0 0 28px 28px' : '0'}!important}` +
        `${scope}"spacer"]{height:${motion.collapse}px!important}` +
        `${scope}"controls"]{margin-top:0!important;translate:0 ${brand.controlsShift}px!important}` +
        `${scope}"mark"]{transition:none!important}` +
        `${scope}"return"]{display:${motion.compact ? 'flex' : 'none'}!important}` +
        `${scope}"hero"]{opacity:1!important;transition:none!important}`
      if (style.textContent !== css) {
        style.textContent = css
        editor.refresh()
      }
      if (root !== brandRoot || brandGeometryDirty) {
        brandGeometryDirty = false
        stopBrandGeometry()
        brandRoot = root
        stopBrandGeometry = root ? observeMobileBrandGeometry(root, schedule) : () => undefined
      }
      if (root) {
        // The fade reaches a slotted control only through the slot's inline display:contents,
        // which the runtime renders and the canvas keeps in an ID rule instead.
        for (const slot of root.querySelectorAll<HTMLElement>(
          '[data-knc-fold="hero"] > [data-knc-slot]',
        ))
          if (slot.style.display !== 'contents') slot.style.display = 'contents'
        paintMobileBrand(
          root,
          motion.collapse,
          height,
          win.matchMedia('(prefers-reduced-motion: reduce)').matches,
        )
      }
    }
    const schedule = (): void => {
      if (!frame) frame = win.requestAnimationFrame(update)
    }
    const changed = (): void => {
      brandGeometryDirty = true
      schedule()
    }
    doc.addEventListener('scroll', schedule, true)
    win.addEventListener('resize', changed)
    editor.on('component:mount', changed)
    update()
    dispose = () => {
      doc.removeEventListener('scroll', schedule, true)
      win.removeEventListener('resize', changed)
      editor.off('component:mount', changed)
      win.cancelAnimationFrame(frame)
      stopBrandGeometry()
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
