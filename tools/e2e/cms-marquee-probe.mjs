// Page functions for page.evaluate: they run in the browser and must stay self-contained.

/** Samples every 50 ms how much of the viewport width a marquee's slides leave uncovered. */
export function installBlankProbe(selector) {
  const track = globalThis.document.querySelector(selector)
  if (!track) throw new Error(`Marquee ${selector} is missing`)
  const offset = () => {
    const transform = globalThis.getComputedStyle(track).transform
    return transform === 'none' ? 0 : new globalThis.DOMMatrixReadOnly(transform).m41
  }
  const probe = { samples: 0, maxBlank: 0, maxHole: 0, offsets: [] }
  globalThis.__marqueeBlankProbe = probe
  // AutoScroll moves the strip about half a pixel between two samples.
  globalThis.setInterval(() => {
    const width = globalThis.innerWidth
    const spans = [...track.children]
      .map((slide) => slide.getBoundingClientRect())
      .map((rect) => [Math.max(0, rect.left), Math.min(width, rect.right)])
      .filter(([left, right]) => right > left)
      .sort((a, b) => a[0] - b[0])
    let covered = 0
    let reach = 0
    // The widest single stretch no slide covers, edges included.
    let hole = 0
    for (const [left, right] of spans) {
      if (right <= reach) continue
      hole = Math.max(hole, left - reach)
      covered += right - Math.max(left, reach)
      reach = right
    }
    probe.maxHole = Math.max(probe.maxHole, hole, width - reach)
    if (width - covered > probe.maxBlank) {
      probe.maxBlank = width - covered
      probe.worst = { offset: offset(), spans }
    }
    // One position per 10 s shows whether the strip kept moving.
    if (probe.samples++ % 200 === 0) probe.offsets.push(offset())
  }, 50)
}

export function readBlankProbe() {
  const probe = globalThis.__marqueeBlankProbe
  if (!probe) throw new Error('The marquee blank probe was not installed')
  return probe
}
