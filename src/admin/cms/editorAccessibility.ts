/**
 * GrapesJS renders its controls outside Preact. Name those UI controls without
 * touching the editable iframe body or any component model/publication data.
 */
export function connectEditorAccessibility(
  canvas: HTMLElement,
  inspector: HTMLElement,
): () => void {
  const enhance = (): void => {
    canvas.querySelectorAll<HTMLIFrameElement>('iframe.gjs-frame').forEach((frame) => {
      frame.title = 'Redigera webbplatsen'
    })
    inspector
      .querySelectorAll<HTMLElement>('#cms-styles .gjs-sm-property, #cms-traits .gjs-trt-trait')
      .forEach((property) => {
        const label = property
          .querySelector<HTMLElement>('.gjs-sm-label, .gjs-label')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim()
        if (!label) return
        property.querySelectorAll<HTMLElement>('input, select, textarea').forEach((field) => {
          // Composite fields carry their own more precise labels.
          if (field.closest('.gjs-sm-property, .gjs-trt-trait') !== property) return
          const units = field.matches('.gjs-input-unit')
          if (!field.getAttribute('aria-label'))
            field.setAttribute('aria-label', `${label}${units ? ' – enhet' : ''}`)
        })
        property.querySelectorAll<HTMLButtonElement>('button[data-add-layer]').forEach((button) => {
          button.setAttribute('aria-label', `Lägg till lager: ${label}`)
          button.title = `Lägg till lager: ${label}`
        })
      })
    inspector.querySelectorAll<HTMLElement>('.gjs-sm-sector-title').forEach((title) => {
      title.tabIndex = 0
      title.setAttribute('role', 'button')
      title.setAttribute(
        'aria-expanded',
        String(title.parentElement?.classList.contains('gjs-sm-open') ?? false),
      )
    })
  }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.matches('.gjs-sm-sector-title, .gjs-block'))
      return
    event.preventDefault()
    target.click()
  }
  const observer = new MutationObserver(enhance)
  observer.observe(canvas, { childList: true, subtree: true })
  observer.observe(inspector, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  })
  inspector.addEventListener('keydown', keydown)
  enhance()
  return () => {
    observer.disconnect()
    inspector.removeEventListener('keydown', keydown)
  }
}
