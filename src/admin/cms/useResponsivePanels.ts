import type { RefObject } from 'preact'
import { restoreCmsFocus } from './focus'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

export type CmsPanel = 'library' | 'inspector' | null
export const compactWorkspace = (): boolean => window.matchMedia('(max-width: 900px)').matches

/** Keep managers mounted; the renderer owns modal semantics and background isolation. */
export function useResponsivePanels(
  root: RefObject<HTMLDivElement>,
  active: CmsPanel,
  close: () => void,
  ready: boolean,
  opener: RefObject<HTMLElement>,
): boolean {
  const [compact, setCompact] = useState(compactWorkspace)
  const currentPanel = useRef(active)
  currentPanel.current = active
  const onClose = useRef(close)
  onClose.current = close
  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 900px)')
    const resize = (): void => {
      setCompact(media.matches)
      if (!media.matches) onClose.current()
    }
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])
  useLayoutEffect(() => {
    const element = root.current
    const viewport = window.visualViewport
    if (!ready || !compact || !element || !viewport) return
    const resize = (): void => {
      // The keyboard changes the visual viewport, not CSS viewport height on iOS.
      // Leave pinch zoom to the browser instead of resizing the app while zooming.
      if (viewport.scale !== 1) return
      element.style.setProperty('--cms-viewport-height', `${viewport.height}px`)
      element.style.setProperty('--cms-viewport-top', `${viewport.offsetTop}px`)
    }
    resize()
    viewport.addEventListener('resize', resize)
    viewport.addEventListener('scroll', resize)
    return () => {
      viewport.removeEventListener('resize', resize)
      viewport.removeEventListener('scroll', resize)
      element.style.removeProperty('--cms-viewport-height')
      element.style.removeProperty('--cms-viewport-top')
    }
  }, [ready, compact, root])
  useLayoutEffect(() => {
    if (!ready || !active || !root.current || !compact) return
    const panel = root.current.querySelector<HTMLElement>(`#cms-${active}`)
    if (!panel) return
    const returnTo = opener.current
    const focusables = (): HTMLElement[] =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, select, summary, [tabindex]',
        ),
      ].filter(
        (node) =>
          node.tabIndex >= 0 &&
          !node.matches(':disabled') &&
          !node.closest('[inert]') &&
          node.getClientRects().length > 0,
      )
    const focusFirst = (): void => (focusables()[0] ?? panel).focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent): void => {
      if (currentPanel.current !== active || document.querySelector('dialog:modal')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose.current()
      } else if (event.key === 'Tab') {
        const items = focusables()
        const first = items[0]
        const last = items.at(-1)
        if (
          !first ||
          !last ||
          !panel.contains(document.activeElement) ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)
        ) {
          event.preventDefault()
          ;(event.shiftKey ? (last ?? panel) : (first ?? panel)).focus()
        }
      }
    }
    const focusin = (event: FocusEvent): void => {
      if (
        currentPanel.current === active &&
        !panel.contains(event.target as Node) &&
        !document.querySelector('dialog:modal')
      )
        focusFirst()
    }
    window.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    focusFirst()
    return () => {
      const restoreFocus =
        panel.contains(document.activeElement) ||
        document.activeElement === document.body ||
        document.activeElement?.matches('.cms-backdrop')
      window.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      if (restoreFocus && !root.current?.querySelector('.cms-workspace-view, dialog[open]'))
        restoreCmsFocus(returnTo)
    }
  }, [active, ready, root, compact, opener])
  return compact
}
