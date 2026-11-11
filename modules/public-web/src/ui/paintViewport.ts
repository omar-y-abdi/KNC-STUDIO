// Paint the two viewport-edge surfaces: the page background (html/body, behind the bottom URL bar)
// and the `theme-color` meta (top header/notch area). Shared by the public shell and the admin hook.

/** The first `<meta>` of that name, appended to the head when the document has none. */
function namedMeta(name: string): Element {
  let meta = document.querySelector(`meta[name="${name}"]`)
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', name)
    document.head.appendChild(meta)
  }
  return meta
}

/** Set the page background + upsert the `theme-color` meta. */
export function paintViewport(pageBg: string, themeColor: string, scheme?: 'light' | 'dark'): void {
  if (scheme) {
    document.documentElement.style.colorScheme = scheme
    document.body.style.colorScheme = scheme
    namedMeta('color-scheme').setAttribute('content', scheme)
  }
  document.documentElement.style.background = pageBg
  document.body.style.background = pageBg
  const meta = namedMeta('theme-color')
  // The OS-specific bootstrap tags are only for the first paint. Once a visitor chooses a
  // theme, expose one unconditional color so browser chrome does not retain an OS variant.
  meta.removeAttribute('media')
  meta.setAttribute('content', themeColor)
  for (const item of document.querySelectorAll('meta[name="theme-color"]'))
    if (item !== meta) item.remove()
}

// Undimmed: above the mobile panel (10), below the privacy banner (30).
const RESTING_Z_INDEX = 20

function edgeTint(edge: 'top' | 'bottom', color: string, zIndex: number): HTMLElement {
  const tint = document.createElement('div')
  tint.setAttribute('data-viewport-edge', edge)
  tint.setAttribute('aria-hidden', 'true')
  const declarations: readonly (readonly [string, string])[] = [
    ['position', 'fixed'],
    [edge, '0'],
    ['left', '0'],
    ['right', '0'],
    ['height', '24px'],
    ['z-index', String(zIndex)],
    ['pointer-events', 'none'],
    ['background-color', color],
    // Safari reads the background colour; the mask paints none of it.
    ['mask-image', 'linear-gradient(transparent, transparent)'],
    ['-webkit-mask-image', 'linear-gradient(transparent, transparent)'],
  ]
  for (const [name, value] of declarations) tint.style.setProperty(name, value)
  return tint
}

/** iOS 26 Safari tints its bars from a fixed box at each edge and keeps a viewport-sized sticky
 *  box's first colour; fresh strips override it. Returns their remover. */
export function paintEdgeTints(
  top: string,
  bottom: string,
  zIndex: number = RESTING_Z_INDEX,
): () => void {
  const tints = [edgeTint('top', top, zIndex), edgeTint('bottom', bottom, zIndex)]
  for (const tint of tints) document.body.appendChild(tint)
  return () => {
    for (const tint of tints) tint.remove()
  }
}

interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

function parseColor(value: string): Rgba | undefined {
  const text = value.trim()
  const hex = /^#([\da-f]{6})$/i.exec(text)?.[1]
  const parts =
    hex === undefined
      ? /^rgba?\((.*)\)$/i
          .exec(text)?.[1]
          ?.split(',')
          .map((part) => (/^\s*\d*\.?\d+\s*$/.test(part) ? Number(part) : NaN))
      : [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  if (parts === undefined || parts.length < 3 || parts.length > 4) return undefined
  const [r = NaN, g = NaN, b = NaN, a = 1] = parts
  return [r, g, b].every((channel) => channel >= 0 && channel <= 255) && a >= 0 && a <= 1
    ? { r, g, b, a }
    : undefined
}

/** The opaque colour of `overlays` painted in order over an opaque `base`; `base` itself when
 *  there is no overlay or a colour cannot be read. */
export function compositeOver(base: string, overlays: readonly string[]): string {
  const under = parseColor(base)
  const layers = overlays.map(parseColor)
  if (overlays.length === 0 || under?.a !== 1) return base
  let { r, g, b } = under
  for (const layer of layers) {
    if (layer === undefined) return base
    r = layer.r * layer.a + r * (1 - layer.a)
    g = layer.g * layer.a + g * (1 - layer.a)
    b = layer.b * layer.a + b * (1 - layer.a)
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
}

/** `document`: the page background below the root an open privacy panel shortens. */
export type LowerEdge = 'panel' | 'section' | 'document'

export interface EdgeColors {
  readonly top: string
  readonly bottom: Readonly<Record<LowerEdge, string>>
}

export interface ViewportDim {
  readonly color: string
  readonly zIndex: number
}

export interface EdgeTintPaint {
  readonly top: string
  readonly bottom: string
  readonly zIndex: number
}

/** One level above the topmost dim: Safari's edge hit test takes the topmost fixed box. */
export function edgeTintPaint(
  colors: EdgeColors,
  lowerEdge: LowerEdge,
  dims: readonly ViewportDim[],
): EdgeTintPaint {
  const overlays = dims.map((dim) => dim.color)
  return {
    top: compositeOver(colors.top, overlays),
    bottom: compositeOver(colors.bottom[lowerEdge], overlays),
    zIndex: Math.max(RESTING_Z_INDEX, ...dims.map((dim) => dim.zIndex + 1)),
  }
}

interface EdgeTintHost {
  colors: EdgeColors | undefined
  lowerEdge: LowerEdge
  dims: readonly ViewportDim[]
  painted: string
  remove: () => void
}

const hosts = new WeakMap<Document, EdgeTintHost>()

function host(): EdgeTintHost {
  let current = hosts.get(document)
  if (current === undefined) {
    current = {
      colors: undefined,
      lowerEdge: 'section',
      dims: [],
      painted: '',
      remove: () => undefined,
    }
    hosts.set(document, current)
  }
  return current
}

function repaint(current: EdgeTintHost): void {
  const next = current.colors && edgeTintPaint(current.colors, current.lowerEdge, current.dims)
  const painted = next ? `${next.top}|${next.bottom}|${next.zIndex}` : ''
  if (painted === current.painted) return
  current.painted = painted
  current.remove()
  current.remove = next ? paintEdgeTints(next.top, next.bottom, next.zIndex) : () => undefined
}

/** Open dims and the reported lower edge outlive the returned hide. */
export function showEdgeTints(colors: EdgeColors): () => void {
  const current = host()
  current.colors = colors
  repaint(current)
  return () => {
    current.colors = undefined
    repaint(current)
  }
}

export function reportLowerEdge(lowerEdge: LowerEdge): void {
  const current = host()
  current.lowerEdge = lowerEdge
  repaint(current)
}

export function dimViewportEdges(dim: ViewportDim): () => void {
  const current = host()
  const entry: ViewportDim = { color: dim.color, zIndex: dim.zIndex }
  current.dims = [...current.dims, entry]
  repaint(current)
  return () => {
    current.dims = current.dims.filter((open) => open !== entry)
    repaint(current)
  }
}
