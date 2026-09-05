import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('shared Turnstile client contract', () => {
  it('exposes recoverable widget failures without changing booking callers', () => {
    const source = readFileSync('src/booking/Turnstile.tsx', 'utf8')

    expect(source).toContain('readonly onError?: () => void')
    expect(source).toContain("'error-callback'")
    expect(source).toContain("'timeout-callback'")
    expect(source).toContain('onErrorRef.current?.()')
  })

  it('gives password recovery a localized retry path for challenge failures', () => {
    const source = readFileSync('src/admin/ForgotPasswordForm.tsx', 'utf8')
    const strings = readFileSync('src/i18n/adminStrings.ts', 'utf8')

    expect(source).toContain('onChallengeError')
    expect(source).toContain('onError={onChallengeError}')
    expect(source).toContain('forgotPwRetryChallenge')
    expect(source).toContain('setTurnstileNonce')
    expect(strings).toContain('forgotPwChallengeError')
    expect(strings).toContain('forgotPwRetryChallenge')
  })
})
