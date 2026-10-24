import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type CmsPage } from '../../shared/cms'
import worker from '../../src/worker'

// TST-2: /terms rendered by the Worker itself, not the static fallback file. The built shell shape
// (entry script, preload, stylesheet in <head>) is derived from the real index.html.
const shell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  .replace('<script type="module" src="/src/main.tsx"></script>', '')
  .replace(
    '</head>',
    '<script type="module" crossorigin src="/assets/entry.js"></script><link rel="modulepreload" crossorigin href="/assets/chunk.js"><link rel="stylesheet" crossorigin href="/assets/entry.css"></head>',
  )
const legalCss =
  ':root{color:#1c1c1e;background:#f4f3f0}@media (prefers-color-scheme: dark){:root{color:#f5f5f7;background:#1c1c1e}}'
const terms: CmsPage = {
  id: '10000000-0000-4000-8000-000000000006',
  kind: 'terms',
  path: '/terms',
  name: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  title: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  description: { sv: '', en: '' },
  inMenu: false,
  content: {
    sv: { html: '<main><h1>Bokningsvillkor</h1></main>', css: { light: legalCss, dark: legalCss } },
    en: { html: '<main><h1>Booking terms</h1></main>', css: { light: legalCss, dark: legalCss } },
  },
}
const presentation = { ...emptyDocument().presentation, pages: [terms] }

const env = {
  SUPABASE_URL: 'https://fixture.invalid',
  SUPABASE_ANON_KEY: 'fixture-anon-key',
  ASSETS: {
    fetch: async (input: Request | URL | string): Promise<Response> =>
      new URL(input instanceof Request ? input.url : input).pathname === '/index.html'
        ? new Response(shell, { headers: { 'Content-Type': 'text/html' } })
        : new Response('Not found', { status: 404 }),
  },
}
const noPublicContent = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}

async function renderTerms(query: string): Promise<string> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/rpc/public_cms_presentation')
      ? Response.json({ revision: 7, presentation })
      : new Response(null, { status: 503 }),
  )
  const response = await worker.fetch(
    new Request(`https://bladeblendstudio.se/terms${query}`),
    env,
    noPublicContent,
  )
  expect(response.status).toBe(200)
  return response.text()
}

function sheet(html: string, id: string): string {
  const start = html.indexOf(`<style id="${id}"`)
  if (start < 0) return ''
  const content = html.indexOf('>', start) + 1
  return html.slice(content, html.indexOf('</style>', content))
}

describe('Worker /terms colour scheme', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['', '?mode=sepia'])('follows the visitor OS scheme for /terms%s', async (query) => {
    const html = await renderTerms(query)
    expect(html).toContain('data-cms-public="1" data-cms-mode="auto"')
    expect(html).toContain('<style id="cms-page-light" media="(prefers-color-scheme: light)">')
    expect(html).toContain('<style id="cms-page-dark" media="(prefers-color-scheme: dark)">')
    expect(sheet(html, 'cms-page-light')).toBe(':root{color:#1c1c1e;background:#f4f3f0}')
    expect(sheet(html, 'cms-page-dark')).toMatch(/:root\{color:#f5f5f7;background:#1c1c1e\}$/)
    expect(html).toContain('<style id="cms-reset">html,body{background:none}</style>')
    expect(html).not.toMatch(/<script\b[^>]*type="module"/)
  })

  it('pins /terms?mode=dark to the dark sheet and colour scheme', async () => {
    const html = await renderTerms('?mode=dark')
    expect(html).toContain('data-cms-mode="dark"')
    expect(html).not.toContain('cms-page-light')
    expect(sheet(html, 'cms-page-dark')).toMatch(/:root\{color:#f5f5f7;background:#1c1c1e\}$/)
    expect(html).toContain('<meta name="color-scheme" content="dark" />')
  })
})
