import type { RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

export type CmsPanel = 'library' | 'inspector' | null
export const compactWorkspace = (): boolean => window.matchMedia('(max-width: 900px)').matches

/** Keep GrapesJS managers mounted while giving the compact drawers modal focus behavior. */
export function useResponsivePanels(
  root: RefObject<HTMLDivElement>,
  active: CmsPanel,
  close: () => void,
  ready: boolean,
): void {
  const onClose = useRef(close)
  onClose.current = close
  useLayoutEffect(() => {
    if (!ready || !active || !root.current || !compactWorkspace()) return
    const panel = root.current.querySelector<HTMLElement>(`#cms-${active}`)
    if (!panel) return
    const opener = document.activeElement
    const previousRole = panel.getAttribute('role')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    const focusables = (): HTMLElement[] =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, select, [tabindex]',
        ),
      ].filter(
        (node) =>
          node.tabIndex >= 0 &&
          !node.matches(':disabled') &&
          !node.closest('[inert]') &&
          node.getClientRects().length > 0,
      )
    const keydown = (event: KeyboardEvent): void => {
      if (document.querySelector('dialog:modal')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose.current()
      } else if (event.key === 'Tab') {
        const items = focusables()
        const first = items[0]
        const last = items.at(-1)
        if (!first || !last) {
          event.preventDefault()
          panel.focus()
        } else if (
          !panel.contains(document.activeElement) ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)
        ) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }
    }
    panel.tabIndex = -1
    focusables()[0]?.focus({ preventScroll: true })
    const media = window.matchMedia('(max-width: 900px)')
    const resize = (): void => {
      if (!media.matches) onClose.current()
    }
    media.addEventListener('change', resize)
    window.addEventListener('keydown', keydown, true)
    return () => {
      const restoreFocus =
        panel.contains(document.activeElement) || document.activeElement === document.body
      window.removeEventListener('keydown', keydown, true)
      media.removeEventListener('change', resize)
      if (previousRole) panel.setAttribute('role', previousRole)
      else panel.removeAttribute('role')
      panel.removeAttribute('aria-modal')
      panel.removeAttribute('tabindex')
      if (restoreFocus && opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true })
    }
  }, [active, ready, root])
}
