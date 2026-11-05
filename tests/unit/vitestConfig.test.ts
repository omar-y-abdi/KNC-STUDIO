import { describe, expect, it } from 'vitest'
import config from '../../vitest.config'

describe('Vitest coverage configuration', () => {
  it('covers the current TypeScript source tree through a source-wide glob', () => {
    for (const source of [
      'src/**/*.{ts,tsx}',
      'modules/*/src/**/*.{ts,tsx}',
      'packages/*/src/**/*.ts',
      'supabase/worker/**/*.ts',
    ])
      expect(config.test?.coverage?.include).toContain(source)
  })
})
