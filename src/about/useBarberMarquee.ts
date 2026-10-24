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

/** The whole-pixel slide width at which any n - 1 slides cover the view on their own. Embla sizes
 * every slide with its gap, so unless the cards overlap, the last one has a negative end margin or
 * the strip widens with its cards, this width loops whatever space-between distributes. */
export function gaplessLoopFloor(view: number, slideCount: number): number {
  return Math.ceil(view / (slideCount - 1))
}

export const MAX_FIT_PASSES = 3

/** The floor of fitting pass `pass` (from 0) after the floor `floor`: the estimate from the
 * measured gaps, at least a pixel wider than before. Widening can shrink distributed gaps
 * (justify-content), so the last pass also takes the gapless floor and the passes end looping. */
export function passFloor(
  pass: number,
  floor: number,
  view: number,
  containerLeft: number,
  slides: readonly LoopSlide[],
): number {
  const estimate = Math.max(loopFloor(view, containerLeft, slides), floor + 1)
  return pass < MAX_FIT_PASSES - 1
    ? estimate
    : Math.max(estimate, gaplessLoopFloor(view, slides.length))
}

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
      // re-measures the floored geometry, and the last one takes the gapless floor (passFloor).
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
        const next = passFloor(passes, floor, track.offsetWidth, track.offsetLeft, geometry())
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
        // Only owner CSS that breaks the gapless floor's premise gets here. A strip that cannot
        // loop would halt at its end, so it falls back to the native scroll layout instead.
        if (passes === MAX_FIT_PASSES && !api.internalEngine().options.loop) {
          setEngineFailed(true)
          throw new Error(`The barber strip cannot loop, not even with ${next}px slides`)
        }
      }
      // Embla 8.6 starts observing slide sizes in a frame it queues on every init and never
      // cancels, so a reInit before that frame orphans the observer. Every init restarts the
      // two-frame delay behind the latest engine's observation; cleanup cancels it.
      const scheduleFit = (): void => {
        window.cancelAnimationFrame(fitFrame)
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
