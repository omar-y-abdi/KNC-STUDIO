import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public discovery documents', () => {
  it('does not advertise unsupported ACP discovery', () => {
    expect(existsSync('public/.well-known/acp.json')).toBe(false)

    const fallback = readFileSync('public/llms.txt', 'utf8')
    expect(fallback).not.toContain('ACP discovery')
    expect(fallback).not.toContain('Agentic Commerce Protocol')
  })

  it('keeps Google OAuth verification copy off the customer homepage', () => {
    const homepage = readFileSync('index.html', 'utf8')
    const oauthHomepage = readFileSync('public/google-calendar.html', 'utf8')

    expect(homepage).not.toContain('Google Calendar')
    expect(homepage).not.toContain('public-home-fallback')
    expect(oauthHomepage).toContain(
      '<title>Google Calendar för personal — Blade &amp; Blend Studio</title>',
    )
    expect(oauthHomepage).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(oauthHomepage).toContain('<h1>Blade &amp; Blend Studio</h1>')
    expect(oauthHomepage).toContain('Purpose of Google Calendar access')
    expect(oauthHomepage).toContain('href="/privacy"')
  })
})
