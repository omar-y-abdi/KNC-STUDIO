import { describe, expect, it } from 'vitest'
import { nudgeStyle, resetNudgeStyle } from '../../src/admin/cms/position'

describe('CMS component nudge', () => {
  it('adds independent translate without replacing rotate/scale transform', () => {
    const style = { transform: 'rotate(12deg) scale(.9)' }
    expect(nudgeStyle(style, 1, -1, 10)).toEqual({
      transform: 'rotate(12deg) scale(.9)',
      translate: '10px -10px',
    })
    expect(resetNudgeStyle(nudgeStyle(style, 1, -1, 10))).toEqual({
      transform: 'rotate(12deg) scale(.9)',
    })
  })

  it('accumulates existing translate values', () => {
    expect(nudgeStyle({ translate: '3px 4px' }, -1, 1, 1).translate).toBe('2px 5px')
  })
})
