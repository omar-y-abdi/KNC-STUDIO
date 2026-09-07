import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolvePointerEnd } from '../../src/about/GalleryMarquee'

describe('gallery marquee interaction contract', () => {
  const source = readFileSync('src/about/GalleryMarquee.tsx', 'utf8')

  it('exposes one keyboard-selectable logical copy and hides loop clones', () => {
    expect(source).toContain('const accessible = j < itemCount')
    expect(source).toContain("aria-hidden={accessible ? undefined : 'true'}")
    expect(source).toContain("role={accessible ? 'button' : undefined}")
    expect(source).toContain('tabIndex={accessible ? 0 : undefined}')
  })

  it('keys selection by physical tile instance so loop clones cannot all highlight', () => {
    expect(source).toContain('const logicalKey =')
    expect(source).toContain('const key = `${logicalKey}:${j}`')
    expect(source).toContain('const selected = props.selectedKey === key')
  })

  it('cancels pointer selection on pointercancel or scrolling and pauses while focused', () => {
    expect(source).toContain('const onPointerCancel =')
    expect(source).toContain('onPointerCancel={onPointerCancel}')
    expect(source).toContain("document.addEventListener('scroll', onScroll")
    expect(source).toContain('onFocus={onRowFocus}')
    expect(source).toContain('onBlur={onRowBlur}')
  })

  it('does not select after pointer down, vertical move, then pointer up', () => {
    const startX = 120
    const startY = 80
    const currentX = 120
    const currentY = 124
    const dx = currentX - startX
    const dy = currentY - startY
    const moved = Math.hypot(dx, dy) > 4
    const lastDx = currentX - startX

    const resolution = resolvePointerEnd(moved, lastDx, 1)

    expect(resolution.shouldSelect).toBe(false)
    expect(resolution.nextDir).toBe(1)
  })

  it('re-anchors the one focusable logical copy when normal motion moved it away', () => {
    expect(source).toContain('const target = e.target')
    expect(source).toContain("target.closest<HTMLElement>('[data-tile-key]')")
    expect(source).toContain("tile.getAttribute('aria-hidden') === 'true'")
    expect(source).toContain('offset.current = 0')
    expect(source).toContain('paint()')
  })
})
