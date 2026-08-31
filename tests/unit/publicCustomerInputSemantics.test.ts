import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public customer input semantics', () => {
  it('identifies name, phone, and email fields for native autofill', () => {
    const details = readFileSync('src/booking/DetailsDialog.tsx', 'utf8')
    const about = readFileSync('src/about/AboutSection.tsx', 'utf8')
    const myBookings = readFileSync('src/mybookings/MyBookingsDialog.tsx', 'utf8')

    expect(details).toContain('type={inputType}')
    expect(details).toContain("autoComplete={inputType === 'text' ? 'name' : inputType}")
    expect(about).toContain('type="tel"')
    expect(about).toContain('autoComplete="tel"')
    expect(myBookings).toContain('autoComplete={type}')
  })
})
