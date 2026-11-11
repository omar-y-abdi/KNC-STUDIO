export interface DeviceTraits {
  readonly userAgent: string
  readonly platform: string
  readonly maxTouchPoints: number
}

export interface ViewportPage {
  querySelector(selector: 'meta[name="viewport"]'): ViewportMeta | null
}

interface ViewportMeta {
  getAttribute(name: 'content'): string | null
  setAttribute(name: 'content', value: string): void
}

export function onIos(device: DeviceTraits): boolean {
  return (
    /iPhone|iPod|iPad/.test(device.userAgent) ||
    (device.platform === 'MacIntel' && device.maxTouchPoints > 1)
  )
}

export function cappedViewport(content: string): string {
  return `${content}, maximum-scale=1`
}

// Safari zooms into a focused field under 16 px and stays zoomed; the cap stops that and still lets
// people pinch. Android browsers obey the cap and would lose pinch zoom, so only iOS gets it.
export function capInputZoom(
  page: ViewportPage = document,
  device: DeviceTraits = navigator,
): () => void {
  if (!onIos(device)) return () => undefined
  const meta = page.querySelector('meta[name="viewport"]')
  const original = meta?.getAttribute('content') ?? null
  if (meta === null || original === null) return () => undefined
  const capped = cappedViewport(original)
  meta.setAttribute('content', capped)
  return () => {
    if (meta.getAttribute('content') === capped) meta.setAttribute('content', original)
  }
}
