import { describe, expect, it } from 'vitest'
import config from '../../vitest.config'

describe('Vitest coverage configuration', () => {
  it('covers the current TypeScript source tree through a source-wide glob', () => {
    expect(config.test?.coverage?.include).toContain('src/**/*.{ts,tsx}')
  })
})
