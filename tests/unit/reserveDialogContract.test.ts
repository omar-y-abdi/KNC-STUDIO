import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const reserveDialog = readFileSync('src/admin/ReserveDialog.tsx', 'utf8')

describe('ReserveDialog manual price contract', () => {
  it('guards invalid non-empty prices before invoking the parent submit', () => {
    expect(reserveDialog).toContain('validateManualReservationPrice')
    expect(reserveDialog).toContain('if (!parsedPrice.ok)')
    expect(reserveDialog).toContain('setPriceError(true)')
    expect(reserveDialog).toContain('return')
    expect(reserveDialog).toContain('t.reserveErrPrice')
    expect(reserveDialog).not.toContain('priceNum ?? 0')
  })

  it('clears price validation after a valid edit and service selection', () => {
    expect(reserveDialog).toContain('setPriceError(false)')
    expect(reserveDialog).toContain('validateManualReservationPrice(v).ok')
    expect(reserveDialog).toContain('if (svc !== undefined) setPrice(String(svc.price))')
  })
})
