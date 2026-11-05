import { describe, expect, it } from 'vitest'
import { checkCancellationHours } from '../../src/admin/cancellationWindow'

describe('cancellation window bounds (database trigger: ^[0-9]{1,3}$, 1..168)', () => {
  it.each(['1', '24', '168', ' 48 ', '007'])('accepts %j', (raw) => {
    const check = checkCancellationHours(raw)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.value).toBe(String(Number(raw.trim())))
  })

  it.each([
    ['', 'empty'],
    ['  ', 'empty'],
    ['0', 'range'],
    ['169', 'range'],
    ['999', 'range'],
    ['1000', 'format'],
    ['-1', 'format'],
    ['2.5', 'format'],
    ['1e2', 'format'],
    ['abc', 'format'],
  ] as const)('rejects %j as %s', (raw, reason) => {
    expect(checkCancellationHours(raw)).toEqual({ ok: false, reason })
  })
})
