import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bookingStrings } from '../../src/i18n/index'

describe('booking dialog close controls', () => {
  it('exposes a localized close action while keeping the visible glyph', () => {
    const details = readFileSync('src/booking/DetailsDialog.tsx', 'utf8')
    const confirmation = readFileSync('src/booking/ConfirmationDialog.tsx', 'utf8')

    expect(bookingStrings('sv').ariaClose).toBe('Stäng')
    expect(bookingStrings('en').ariaClose).toBe('Close')
    expect(details).toContain('aria-label={t.ariaClose}')
    expect(confirmation).toContain('aria-label={t.ariaClose}')
    expect(details).toContain('>\n          ×\n        </button>')
    expect(confirmation).toContain('>\n        ×\n      </button>')
  })
})
