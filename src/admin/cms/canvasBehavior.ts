import type { Editor } from 'grapesjs'
import { mobileFold } from '../../app/mobileFold'
import type { CmsScene } from '../../cms/Scene'
import { SITE_THEME_DEFAULTS } from '../../../shared/site-theme'
import type { CmsMode } from '../../../shared/cms'

export function sceneVisibilityCss(scene: CmsScene, mode: CmsMode): string {
  const scenes = ['booking-options', 'booking-details', 'booking-confirmation', 'my-bookings-list']
  return scene === 'default'
    ? scenes
        .map((name) => `[data-knc-native]>[data-knc-surface="${name}"]{display:none!important}`)
        .join('')
    : `body{background:var(--knc-background,${SITE_THEME_DEFAULTS[mode].background})} [data-knc-native]>[data-knc-surface]:not([data-knc-surface="${scene}"]){display:none!important}`
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
    const update = (): void => {
      frame = 0
      const root = doc.querySelector<HTMLElement>('[data-knc-surface="mobile-home"]')
      const motion = mobileFold(root?.scrollTop ?? 0, win.innerHeight)
      const scope = '[data-knc-surface="mobile-home"] [data-knc-fold='
      style.textContent =
        visibility +
        `${scope}"panel"]{position:sticky!important;top:0!important;height:calc(100dvh - ${motion.collapse}px)!important;border-radius:${motion.compact ? '0 0 28px 28px' : '0'}!important}` +
        `${scope}"spacer"]{height:${motion.collapse}px!important}` +
        `${scope}"controls"]{margin-top:${motion.compact ? 24 : 0}px!important}` +
        `${scope}"mark"]{opacity:${motion.compact ? 1 : 0}!important}` +
        `${scope}"return"]{display:${motion.compact ? 'flex' : 'none'}!important}` +
        `${scope}"hero"]{opacity:${motion.opacity}!important;pointer-events:${motion.opacity === 0 ? 'none' : 'auto'}!important}`
      editor.refresh()
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
      style.remove()
    }
  }
  editor.on('canvas:frame:load', attach)
  attach()
  return () => {
    editor.off('canvas:frame:load', attach)
    dispose()
  }
}
