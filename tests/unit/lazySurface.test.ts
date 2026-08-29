import { describe, expect, it } from 'vitest'
import { LazyLoadBoundary } from '../../src/ui/LazySurface'

describe('lazy surface error boundary', () => {
  it('replaces a failed lazy child with the visible recovery surface', () => {
    const boundary = new LazyLoadBoundary({ children: 'loaded', error: 'reload' }, {})

    expect(boundary.render()).toBe('loaded')
    boundary.state = LazyLoadBoundary.getDerivedStateFromError()
    expect(boundary.render()).toBe('reload')
  })
})
