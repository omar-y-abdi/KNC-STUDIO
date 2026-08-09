import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface AcpDiscovery {
  readonly protocol: {
    readonly name: string
    readonly version: string
  }
  readonly api_base_url: string
  readonly transports: readonly string[]
  readonly capabilities: {
    readonly services: readonly unknown[]
  }
}

describe('public discovery documents', () => {
  it('publishes a valid ACP discovery document', () => {
    const discovery = JSON.parse(
      readFileSync('public/.well-known/acp.json', 'utf8'),
    ) as AcpDiscovery

    expect(discovery.protocol.name).toBe('acp')
    expect(discovery.protocol.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new URL(discovery.api_base_url).protocol).toMatch(/^https?:$/)
    expect(discovery.transports.length).toBeGreaterThan(0)
    expect(discovery.capabilities.services.length).toBeGreaterThan(0)
  })

  it('keeps Google OAuth verification copy off the customer homepage', () => {
    const homepage = readFileSync('index.html', 'utf8')
    const oauthHomepage = readFileSync('public/google-calendar.html', 'utf8')

    expect(homepage).not.toContain('Google Calendar')
    expect(homepage).not.toContain('public-home-fallback')
    expect(oauthHomepage).toContain('<title>Blade &amp; Blend Studio</title>')
    expect(oauthHomepage).toContain('<h1>Blade &amp; Blend Studio</h1>')
    expect(oauthHomepage).toContain('Purpose of Google Calendar access')
    expect(oauthHomepage).toContain('href="/privacy"')
  })
})
