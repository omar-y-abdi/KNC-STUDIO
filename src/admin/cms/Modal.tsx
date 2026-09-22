import type { ComponentChildren, JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { CmsIcon } from './Icon'

/** Native top-layer modal, as in o-y-a: canvas stacking must never cover a panel. */
export function CmsModal({
  title,
  wide = false,
  onClose,
  children,
  footer,
}: {
  title: string
  wide?: boolean
  onClose: () => void
  children: ComponentChildren
  footer?: ComponentChildren
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const opener = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      class={`cms-dialog${wide ? ' cms-dialog-wide' : ''}`}
      aria-label={title}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <strong>{title}</strong>
        <button type="button" aria-label="Stäng panel" onClick={onClose}>
          <CmsIcon name="close" />
        </button>
      </header>
      <div class="cms-dialog-body">{children}</div>
      {footer && <footer class="cms-dialog-footer">{footer}</footer>}
    </dialog>
  )
}
