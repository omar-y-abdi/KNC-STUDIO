import { describe, expect, it } from 'vitest'
import { configuredTurnstileWidgetMode } from '../../modules/public-web/src/booking/turnstileWidgetMode'

describe('Turnstile public widget mode contract', () => {
  it.each(['managed', 'non-interactive', 'invisible'] as const)('accepts configured %s', (mode) => {
    expect(configuredTurnstileWidgetMode('public-key', ` ${mode} `)).toBe(mode)
  })
  it.each([undefined, '', 'auto', 'hidden'])('rejects configured key with mode %j', (mode) => {
    expect(() => configuredTurnstileWidgetMode('public-key', mode)).toThrow(
      'VITE_TURNSTILE_WIDGET_MODE',
    )
  })
  it('allows offline operation without a site key', () => {
    expect(configuredTurnstileWidgetMode(undefined, undefined)).toBeNull()
    expect(configuredTurnstileWidgetMode(' ', 'invisible')).toBeNull()
  })
})
