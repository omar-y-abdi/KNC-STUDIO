import { describe, it, expect } from 'vitest'
import { initialEscalation, nextEscalation } from '../../src/mybookings/escalation'

describe('nextEscalation', () => {
  it('a first unknown number → "first", remembering it', () => {
    const step = nextEscalation(initialEscalation, '0700000000')
    expect(step.level).toBe('first')
    expect(step.state.lastFailed).toBe('0700000000')
  })

  it('the SAME number a second time → "escalated"', () => {
    const first = nextEscalation(initialEscalation, '0700000000')
    const second = nextEscalation(first.state, '0700000000')
    expect(second.level).toBe('escalated')
    expect(second.state.lastFailed).toBe('0700000000')
  })

  it('a DIFFERENT number resets to "first"', () => {
    const first = nextEscalation(initialEscalation, '0700000000')
    const other = nextEscalation(first.state, '0701111111')
    expect(other.level).toBe('first')
    expect(other.state.lastFailed).toBe('0701111111')
  })

  it('does not mutate the previous state', () => {
    const prev = { lastFailed: '0700000000' }
    nextEscalation(prev, '0701111111')
    expect(prev.lastFailed).toBe('0700000000')
  })
})
