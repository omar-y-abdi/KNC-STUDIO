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
      syncAutoScroll()
      track.addEventListener('focusin', pauseOnFocus)
      track.addEventListener('focusout', resumeAfterFocus)
      api.on('pointerUp', resumeAfterPointer)
      api.on('reInit', syncAutoScroll)
      return () => {
        api.off('pointerUp', resumeAfterPointer)
        api.off('reInit', syncAutoScroll)
        track.removeEventListener('focusin', pauseOnFocus)
        track.removeEventListener('focusout', resumeAfterFocus)
        if (focusResumeTimer.current !== null) window.clearTimeout(focusResumeTimer.current)
        focusResumeTimer.current = null
        if (pointerResumeFrame.current !== null)
          window.cancelAnimationFrame(pointerResumeFrame.current)
        pointerResumeFrame.current = null
        api.destroy()
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
