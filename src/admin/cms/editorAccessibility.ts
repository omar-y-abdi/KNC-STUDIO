/**
 * Label third-party editor chrome without touching the iframe document or saved
 * component model. GrapesJS recreates fields when selection/sectors change.
 */
export function labelEditorChrome(root: HTMLElement): () => void {
  const label = (): void => {
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe.gjs-frame'))
      frame.title = 'Redigerbar webbplats'

    for (const field of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '#cms-styles input, #cms-styles select, #cms-traits input, #cms-traits select',
    )) {
      if (
        field.labels?.length ||
        field.hasAttribute('aria-label') ||
        field.hasAttribute('aria-labelledby')
      )
        continue
      const property = field.closest('.gjs-sm-property, .gjs-trt-trait')
      const name = property
        ?.querySelector('.gjs-sm-label, .gjs-trt-trait__label')
        ?.textContent?.trim()
      if (!name) continue
      const unit = field.closest('.gjs-input-unit') ? ' · enhet' : ''
      field.setAttribute('aria-label', `${name}${unit}`)
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '#cms-styles button[data-add-layer]',
    )) {
      const name = button
        .closest('.gjs-sm-property')
        ?.querySelector('.gjs-sm-label')
        ?.textContent?.trim()
      if (name) button.setAttribute('aria-label', `Lägg till ${name}`)
    }
  }
  label()
  // Attribute writes above cannot trigger this observer. No listeners are added
  // to the public page, and teardown precedes editor.destroy().
  const observer = new MutationObserver(label)
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}
