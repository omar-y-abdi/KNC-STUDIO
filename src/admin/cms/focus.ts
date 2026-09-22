/** Restore focus to the actual opener, or its visible compact navigation equivalent. */
export function restoreCmsFocus(opener: Element | null): void {
  const visible = (node: Element | null): node is HTMLElement => {
    if (
      !(node instanceof HTMLElement) ||
      !node.isConnected ||
      node.closest('[inert]') ||
      node.matches(':disabled')
    )
      return false
    const rect = node.getBoundingClientRect()
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
    )
  }
  const panel = opener?.closest('#cms-library, #cms-inspector')
  const compactTrigger = panel
    ? document.querySelector<HTMLElement>(`.cms-mobile-tools [aria-controls="${panel.id}"]`)
    : document.querySelector<HTMLElement>('.cms-mobile-tools button')
  const target = visible(opener)
    ? opener
    : visible(compactTrigger)
      ? compactTrigger
      : document.querySelector<HTMLElement>('.cms-brand')
  if (visible(target)) target.focus({ preventScroll: true })
}
