import type EmblaFactory from 'embla-carousel'
import type { EmblaCarouselType } from 'embla-carousel'
import type AutoScrollFactory from 'embla-carousel-auto-scroll'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

interface UseBarberMarqueeOptions {
  readonly enabled: boolean
  readonly source: boolean
  readonly rosterIds: readonly string[]
  readonly rootRef: { readonly current: HTMLElement | null }
  readonly trackRef: { readonly current: HTMLElement | null }
}

/** One slide as Embla measures it: offsets, plus the end margin of the last slide. */
export interface LoopSlide {
  readonly left: number
  readonly width: number
  readonly marginEnd: number
}

/** The smallest whole-pixel slide width at which Embla keeps `loop` (SlideLooper.canLoop: the other
 * slides with their gaps cover the view). Like Embla, the first slide counts its start gap, the
 * last its end margin and every inner slide the distance to the next slide. */
export function loopFloor(
  view: number,
  containerLeft: number,
  slides: readonly LoopSlide[],
): number {
  const gaps = slides.map((slide, index) => {
    if (index === 0) return Math.abs(containerLeft - slide.left)
    if (index === slides.length - 1) return slide.marginEnd
    return (slides[index + 1]?.left ?? slide.left) - slide.left - slide.width
  })
  const total = gaps.reduce((sum, gap) => sum + gap, 0)
  return Math.max(...gaps.map((gap) => Math.ceil((view - (total - gap)) / (slides.length - 1))))
}

const MAX_FIT_PASSES = 3

function reducedMotionPreference(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Attach Embla to the existing About section and stylist-grid nodes, preserving native identities. */
export function useBarberMarquee({
  enabled,
  source,
  rosterIds,
  rootRef,
  trackRef,
}: UseBarberMarqueeOptions) {
  const [selected, setSelected] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(reducedMotionPreference)
  const [engineFailed, setEngineFailed] = useState(false)
  const carousel = useRef<EmblaCarouselType | null>(null)
  const focusWithin = useRef(false)
  const focusResumeTimer = useRef<number | null>(null)
  const pointerResumeFrame = useRef<number | null>(null)
  const selectedRef = useRef(selected)
  const selectedNodeRef = useRef<HTMLElement | null>(null)
  selectedRef.current = selected

  const toggle = (id: string, node: HTMLElement): void => {
    const next = selectedRef.current === id ? null : id
    selectedRef.current = next
    selectedNodeRef.current = next === null ? null : node
    setSelected(next)
  }

  useEffect(() => {
    if (selected !== null && !rosterIds.includes(selected)) {
      selectedNodeRef.current = null
      setSelected(null)
    }
  }, [rosterIds, selected])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReducedMotion(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const animate = enabled && !source && !reducedMotion && !engineFailed && rosterIds.length > 1
  useEffect(() => {
    const root = rootRef.current
    const track = trackRef.current
    if (!root || !track || !animate) return
    const attach = (
      EmblaCarousel: typeof EmblaFactory,
      AutoScroll: typeof AutoScrollFactory,
    ): (() => void) => {
      focusWithin.current = track.contains(document.activeElement)
      const api = EmblaCarousel(
        root,
        {
          container: track,
          loop: true,
          dragFree: true,
          align: 'center',
          watchDrag: (_embla, event) =>
            event.target instanceof Node && track.contains(event.target),
        },
        [
          AutoScroll({
            speed: 0.18,
            startDelay: 800,
            playOnInit: false,
            stopOnInteraction: true,
            stopOnFocusIn: false,
          }),
        ],
      )
      carousel.current = api
      // A short roster or narrow owner cards make Embla drop loop, and AutoScroll then halts at the
      // end. Widen every slide just enough to loop; inline !important outranks the owner's #id
      // rules, and the remembered inline value returns as soon as the slides loop on their own.
      const floors = new Map<HTMLElement, { readonly value: string; readonly priority: string }>()
      let floor = 0
      let passes = 0
      let ownReInit = false
      let fitFrame = 0
      const restoreSlides = (): void => {
        for (const [node, natural] of floors)
          node.style.setProperty('min-width', natural.value, natural.priority)
        floors.clear()
        floor = 0
      }
      const geometry = (): LoopSlide[] => {
        const slides = api.slideNodes()
        const last = slides[slides.length - 1]
        return slides.map((node) => ({
          left: node.offsetLeft,
          width: node.offsetWidth,
          marginEnd: node === last ? parseFloat(window.getComputedStyle(node).marginRight) : 0,
        }))
      }
      // Measured without the floor, restored in the same task: nothing paints or resizes meanwhile.
      const loopsAlone = (): boolean => {
        for (const [node, natural] of floors)
          node.style.setProperty('min-width', natural.value, natural.priority)
        const slides = geometry()
        for (const node of floors.keys())
          node.style.setProperty('min-width', `${floor}px`, 'important')
        const needed = loopFloor(track.offsetWidth, track.offsetLeft, slides)
        return slides.every((slide) => slide.width >= needed)
      }
      const reInit = (): void => {
        ownReInit = true
        api.reInit()
      }
      // One reInit per pass. Widening can shrink distributed gaps (justify-content), so each pass
      // re-measures the floored geometry; after MAX_FIT_PASSES the widest floor tried stays.
      const fitLoop = (): void => {
        fitFrame = 0
        if (api.slideNodes().length < 2) return
        if (floors.size && loopsAlone()) {
          restoreSlides()
          passes = 0
          reInit()
          return
        }
        if (api.internalEngine().options.loop || passes >= MAX_FIT_PASSES) return
        const next = Math.max(loopFloor(track.offsetWidth, track.offsetLeft, geometry()), floor + 1)
        for (const node of api.slideNodes()) {
          if (!floors.has(node))
            floors.set(node, {
              value: node.style.getPropertyValue('min-width'),
              priority: node.style.getPropertyPriority('min-width'),
            })
          node.style.setProperty('min-width', `${next}px`, 'important')
        }
        floor = next
        passes += 1
        reInit()
      }
      // Embla 8.6 starts observing slide sizes one frame after each init, and a reInit before that
      // frame orphans the observer. Fit only after two frames, coalesced, and cancel on cleanup.
      const scheduleFit = (): void => {
        if (fitFrame) return
        fitFrame = window.requestAnimationFrame(() => {
          fitFrame = window.requestAnimationFrame(fitLoop)
        })
      }
      const fitAfterReInit = (): void => {
        if (ownReInit) ownReInit = false
        else passes = 0
        scheduleFit()
      }
      const syncAutoScroll = (): void => {
        const autoScroll = api.plugins().autoScroll
        const selectedId = selectedRef.current
        if (selectedId !== null) {
          autoScroll?.stop()
          const node = selectedNodeRef.current
          const index = node === null ? -1 : api.slideNodes().indexOf(node)
          if (index >= 0) api.scrollTo(index, true)
        } else if (focusWithin.current) autoScroll?.stop()
        else autoScroll?.play()
      }
      const pauseOnFocus = (): void => {
        focusWithin.current = true
        api.plugins().autoScroll?.stop()
      }
      const resumeAfterFocus = (event: FocusEvent): void => {
        const next = event.relatedTarget
        if (next instanceof Node && track.contains(next)) return
        if (focusResumeTimer.current !== null) window.clearTimeout(focusResumeTimer.current)
        focusResumeTimer.current = window.setTimeout(() => {
          focusResumeTimer.current = null
          focusWithin.current = track.contains(document.activeElement)
          if (selectedRef.current === null && !focusWithin.current) api.plugins().autoScroll?.play()
        }, 0)
      }
      const resumeAfterPointer = (): void => {
        if (pointerResumeFrame.current !== null)
          window.cancelAnimationFrame(pointerResumeFrame.current)
        pointerResumeFrame.current = window.requestAnimationFrame(() => {
          pointerResumeFrame.current = null
          syncAutoScroll()
        })
      }
      scheduleFit()
      syncAutoScroll()
      track.addEventListener('focusin', pauseOnFocus)
      track.addEventListener('focusout', resumeAfterFocus)
      api.on('pointerUp', resumeAfterPointer)
      api.on('reInit', fitAfterReInit)
      api.on('reInit', syncAutoScroll)
      return () => {
        api.off('pointerUp', resumeAfterPointer)
        api.off('reInit', fitAfterReInit)
        api.off('reInit', syncAutoScroll)
        track.removeEventListener('focusin', pauseOnFocus)
        track.removeEventListener('focusout', resumeAfterFocus)
        if (focusResumeTimer.current !== null) window.clearTimeout(focusResumeTimer.current)
        focusResumeTimer.current = null
        if (pointerResumeFrame.current !== null)
          window.cancelAnimationFrame(pointerResumeFrame.current)
        pointerResumeFrame.current = null
        window.cancelAnimationFrame(fitFrame)
        api.destroy()
        restoreSlides()
        carousel.current = null
      }
    }
    // Embla loads only when the strip animates (mobile, motion allowed), so a desktop visit never
    // requests it. An unmount or dependency change before the import settles creates nothing. If the
    // chunk cannot load, the strip falls back to the native scroll layout and the error still
    // surfaces as an unhandled rejection.
    let cancelled = false
    let detach: (() => void) | null = null
    void Promise.all([import('embla-carousel'), import('embla-carousel-auto-scroll')]).then(
      ([embla, autoScroll]) => {
        if (cancelled) return
        detach = attach(embla.default, autoScroll.default)
      },
      (error: unknown) => {
        if (!cancelled) setEngineFailed(true)
        throw error
      },
    )
    return () => {
      cancelled = true
      detach?.()
    }
  }, [animate, rootRef, rosterIds.length, trackRef])

  const rosterKey = rosterIds.join('\u0000')
  useLayoutEffect(() => {
    const api = carousel.current
    if (!api) return
    const autoScroll = api.plugins().autoScroll
    if (selected !== null) {
      autoScroll?.stop()
      const node = selectedNodeRef.current
      const index = node === null ? -1 : api.slideNodes().indexOf(node)
      if (index >= 0) api.scrollTo(index, true)
    } else if (!focusWithin.current) autoScroll?.play()
  }, [selected, rosterKey])

  return { selected, toggle, reducedMotion, animate }
}
