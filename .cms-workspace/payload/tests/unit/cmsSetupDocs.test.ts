import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CMS setup documentation contract', () => {
  it('ships the setup guide referenced by the studio and documents the required rollout surfaces', () => {
    expect(existsSync('docs/CMS-SETUP.md')).toBe(true)
    const setup = readFileSync('docs/CMS-SETUP.md', 'utf8')
    expect(setup).toContain('20260915030000_unified_cms.sql')
    expect(setup).toContain('20260915040000_cms_media_bridge.sql')
    expect(setup).toContain('cms-studio')
    expect(setup).toContain('upload-image')
    expect(setup).toContain('VITE_SUPABASE_URL')
    expect(setup).toContain('VITE_SUPABASE_ANON_KEY')
  })
})
