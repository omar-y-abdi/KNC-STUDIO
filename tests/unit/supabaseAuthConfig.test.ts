import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('tracked Supabase Auth configuration', () => {
  it('keeps unused anonymous Auth disabled and email links at one hour', () => {
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')

    expect(config.match(/^enable_anonymous_sign_ins = false$/gm)).toEqual([
      'enable_anonymous_sign_ins = false',
    ])
    expect(config.match(/^otp_expiry = 3600$/gm)).toEqual(['otp_expiry = 3600'])
  })
})
