/** Label third-party editor chrome without touching components or exported page markup. */
export function editorAccessibility(host: HTMLElement, inspector: HTMLElement | null): () => void {
  const labelControls = (): void => {
    for (const frame of host.querySelectorAll<HTMLIFrameElement>('iframe.gjs-frame'))
      frame.title = 'Sidans redigerbara förhandsvisning'
    if (!inspector) return
    for (const property of inspector.querySelectorAll<HTMLElement>('.gjs-sm-property')) {
      const label = property
        .querySelector(':scope > [data-sm-label] .gjs-sm-icon')
        ?.textContent?.trim()
      if (!label) continue
      for (const field of property.querySelectorAll<HTMLElement>('input, select')) {
        // Composite properties contain child properties with their own labels.
        if (field.closest('.gjs-sm-property') !== property) continue
        field.setAttribute(
          'aria-label',
          `${label}${field.matches('.gjs-input-unit') ? ' · enhet' : ''}`,
        )
      }
      for (const button of property.querySelectorAll<HTMLButtonElement>('[data-add-layer]')) {
        if (button.closest('.gjs-sm-property') !== property) continue
        button.setAttribute('aria-label', `Lägg till ${label.toLowerCase()}`)
      }
    }
  }
  // GrapesJS recreates fields when the selected component or a style stack changes.
  // Observe structure only: writing our labels must not trigger another observation.
  const observer = new MutationObserver(labelControls)
  observer.observe(host, { childList: true, subtree: true })
  if (inspector) observer.observe(inspector, { childList: true, subtree: true })
  labelControls()
  return () => observer.disconnect()
}
