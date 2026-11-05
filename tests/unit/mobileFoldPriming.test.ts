import { describe, expect, it, vi } from 'vitest'
import { primeMobileFold } from '../../modules/public-web/src/app/mobileFold'

class FoldRoot extends EventTarget {
  scrollTop = 0
  readonly editing: boolean
  readonly button: boolean
  constructor(editing = false, button = false) {
    super()
    this.editing = editing
    this.button = button
  }
  closest(selector: string) {
    if (selector.startsWith('input')) return this.editing ? this : null
    return this.button ? this : null
  }
}
const event = (type: string, values: Record<string, unknown> = {}): Event => {
  const event = new Event(type, { cancelable: true })
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value })
  return event
}
const touch = (type: string, y: number): Event => event(type, { touches: [{ clientY: y }] })
const install = (root: FoldRoot, change: (active: boolean) => void) => {
  const dispose = primeMobileFold(root as unknown as HTMLElement, change)
  if (vi.isMockFunction(change)) change.mockClear()
  return dispose
}

describe('native mobile fold priming', () => {
  it('leaves taps alone and primes only the first real forward movement without cancelling the gesture', () => {
    const root = new FoldRoot()
    const change = vi.fn()
    const dispose = install(root, change)
    root.dispatchEvent(touch('touchstart', 300))
    root.dispatchEvent(touch('touchend', 300))
    expect(change).not.toHaveBeenCalledWith(true)
    change.mockClear()
    root.dispatchEvent(touch('touchstart', 300))
    root.dispatchEvent(touch('touchmove', 310)) // Overscroll at the resting home is not a fold.
    expect(change).not.toHaveBeenCalled()
    const move = touch('touchmove', 290)
    root.dispatchEvent(move)
    root.dispatchEvent(touch('touchmove', 280))
    expect(move.defaultPrevented).toBe(false)
    expect(change).toHaveBeenCalledExactlyOnceWith(true)
    root.scrollTop = 200
    root.dispatchEvent(touch('touchend', 280))
    expect(change).toHaveBeenCalledTimes(1)
    root.scrollTop = 0
    root.dispatchEvent(event('scroll'))
    expect(change).toHaveBeenLastCalledWith(false)
    dispose()
    change.mockClear()
    root.dispatchEvent(touch('touchstart', 300))
    root.dispatchEvent(touch('touchmove', 200))
    root.dispatchEvent(event('wheel', { deltaY: 10 }))
    root.dispatchEvent(event('scroll'))
    expect(change).not.toHaveBeenCalled()
  })

  it('registers the blocking first move before touchstart and re-arms only at idle zero', () => {
    const root = new FoldRoot()
    const add = vi.spyOn(root, 'addEventListener')
    const remove = vi.spyOn(root, 'removeEventListener')
    const dispose = install(root, vi.fn())
    const moves = () => add.mock.calls.filter(([name]) => name === 'touchmove')
    expect(moves()).toEqual([['touchmove', expect.any(Function), { passive: false }]])
    root.dispatchEvent(touch('touchstart', 300))
    expect(moves()).toHaveLength(1)
    root.dispatchEvent(touch('touchmove', 200))
    expect(remove).toHaveBeenCalledWith('touchmove', moves()[0]?.[1])
    root.scrollTop = 200
    root.dispatchEvent(touch('touchend', 200))
    expect(moves()).toHaveLength(1)
    root.scrollTop = 0
    root.dispatchEvent(event('scroll'))
    root.dispatchEvent(event('scroll'))
    expect(moves()).toHaveLength(2)
    dispose()
  })

  it('keeps the native carrier through a reversal at zero until the active gesture ends', () => {
    const root = new FoldRoot()
    const change = vi.fn()
    const dispose = install(root, change)
    root.dispatchEvent(touch('touchstart', 300))
    root.dispatchEvent(touch('touchmove', 200))
    root.dispatchEvent(event('scroll'))
    expect(change).toHaveBeenCalledExactlyOnceWith(true)
    root.dispatchEvent(touch('touchcancel', 200))
    expect(change).toHaveBeenLastCalledWith(false)
    dispose()
  })

  it('primes scrolling keys and wheel but not editing, theme-button Space, zoom, or cancelled events', () => {
    const root = new FoldRoot()
    const change = vi.fn()
    const dispose = install(root, change)
    root.dispatchEvent(event('keydown', { key: ' ', target: new FoldRoot(false, true) }))
    root.dispatchEvent(event('keydown', { key: 'ArrowDown', target: new FoldRoot(true) }))
    root.dispatchEvent(event('wheel', { deltaY: 20, ctrlKey: true }))
    const cancelled = event('wheel', { deltaY: 20 })
    cancelled.preventDefault()
    root.dispatchEvent(cancelled)
    expect(change).not.toHaveBeenCalled()
    root.dispatchEvent(event('keydown', { key: 'PageDown' }))
    expect(change).toHaveBeenLastCalledWith(true)
    root.dispatchEvent(event('scroll'))
    expect(change).toHaveBeenLastCalledWith(false)
    root.dispatchEvent(event('wheel', { deltaY: 20 }))
    expect(change).toHaveBeenLastCalledWith(true)
    dispose()
  })
})
