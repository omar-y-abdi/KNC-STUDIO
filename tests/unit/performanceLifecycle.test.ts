import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function ordered(source: string, tokens: readonly string[]): void {
  let cursor = -1
  for (const token of tokens) {
    const next = source.indexOf(token, cursor + 1)
    expect(next, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor)
    cursor = next
  }
}

describe('public performance lifecycles', () => {
  it('defers About data ports until the section intersects', () => {
    const source = readFileSync('src/about/AboutSection.tsx', 'utf8')

    ordered(source, [
      'const [dataActive, setDataActive] = useState(!deferPublicData)',
      'const observer = new IntersectionObserver(',
      'if (entries.some((entry) => entry.isIntersecting))',
      'setDataActive(true)',
      'if (!dataActive || aboutContentIsMock) return',
      'useRoster(props.barbersPort, dataActive)',
      "useGallery('salon', props.galleryPort, dataActive)",
      'if (!dataActive) return',
    ])
  })

  it('runs gallery animation only when motion is allowed, visible, and intersecting', () => {
    const source = readFileSync('src/about/GalleryMarquee.tsx', 'utf8')

    ordered(source, [
      'const reduce = useRef(prefersReducedMotion())',
      'if (reduce.current) return',
      'if (running || document.hidden || !intersecting) return',
      "document.addEventListener('visibilitychange', onVisibility)",
      'observer = new IntersectionObserver(',
      'if (intersecting) start()',
      'else stop()',
    ])
  })

  it('coalesces mobile scroll updates into one animation frame and cancels cleanup work', () => {
    const source = readFileSync('src/app/MobileSite.tsx', 'utf8')

    ordered(source, [
      'const scrollFrame = useRef<number | null>(null)',
      'if (inSection || scrollFrame.current !== null) return',
      'scrollFrame.current = requestAnimationFrame(() => {',
      'scrollFrame.current = null',
      'syncCollapse()',
      'cancelAnimationFrame(scrollFrame.current)',
    ])
  })
})
