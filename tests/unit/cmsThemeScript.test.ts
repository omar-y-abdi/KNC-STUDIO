import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CMS_THEME_SCRIPT } from '../../src/site/cmsThemeScript'

const scriptSources = (): readonly string[] => {
  const headers = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8')
  const policy = headers.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1] ?? ''
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src '))
  return directive?.split(/\s+/).slice(1) ?? []
}

describe('CMS page theme script', () => {
  it('runs under the production CSP through its exact hash, without unsafe-inline', () => {
    const hash = createHash('sha256').update(CMS_THEME_SCRIPT, 'utf8').digest('base64')
    expect(scriptSources()).toContain(`'sha256-${hash}'`)
    expect(scriptSources()).not.toContain("'unsafe-inline'")
  })

  it('cannot close its own script element', () => {
    expect(CMS_THEME_SCRIPT).not.toMatch(/<\/script/i)
  })
})
