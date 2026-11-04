import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CmsPage, CmsPresentation } from '../../shared/cms'
import worker from '../../src/worker'

// G23 (PR #104 final gate): what a /contact request reads. The committed revision-56 publication
// holds no Contact page and is 1.35 MB of JSON; every request for /contact used to read and validate
// all of it before serving the static fallback, and HEAD rendered an authored Contact only to drop
// the body. Supabase is answered as the database answers: public_cms_page_metadata returns the
// page's title, description and revision, or null when no page has that path.

const shell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const publicFile = (path: string): string =>
  readFileSync(new URL(`../../public${path}`, import.meta.url), 'utf8')
const revision56 = (): CmsPresentation =>
  JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
    ).toString('utf8'),
  ).presentation
const contactSource = publicFile('/contact.html')
const contact: CmsPage = {
  id: '10000000-0000-4000-8000-000000000007',
  kind: 'page',
  path: '/contact',
  name: { sv: 'Kontakt', en: 'Contact' },
  title: { sv: '', en: '' },
  description: { sv: '', en: '' },
  inMenu: false,
  content: Object.fromEntries(
    (['sv', 'en'] as const).map((lang) => [
      lang,
      {
        html:
          lang === 'sv'
            ? contactSource.slice(
                contactSource.indexOf('<body>') + '<body>'.length,
                contactSource.indexOf('</body>'),
              )
            : readFileSync(
                new URL('../../src/admin/cms/contact.en.html', import.meta.url),
                'utf8',
              ).trim(),
        css: { light: '', dark: '' },
      },
    ]),
  ) as CmsPage['content'],
}
const discovery = {
  settings: { business_name: 'Aktuell Salong', business_city: 'Malmö' },
  barbers: [],
  services: [],
  schedules: [],
}
const noPublicContent = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}

/** One /contact request against `presentation`, recording every RPC and asset it reads. */
async function requestContact(presentation: CmsPresentation, method: 'GET' | 'HEAD') {
  const rpcs: string[] = []
  const assets: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const rpc = String(input).split('/').at(-1) ?? ''
    rpcs.push(rpc)
    if (rpc === 'public_cms_presentation')
      return new Response(JSON.stringify({ revision: 56, presentation }))
    if (rpc === 'public_cms_page_metadata') {
      const { p_path: path, p_lang: lang } = JSON.parse(String(init?.body)) as {
        p_path: string
        p_lang: 'sv' | 'en'
      }
      const page = presentation.pages.find((item) => item.path === path)
      return Response.json(
        page
          ? { revision: 56, title: page.title[lang], description: page.description[lang] }
          : null,
      )
    }
    if (rpc === 'public_business_discovery') return Response.json(discovery)
    return new Response(null, { status: 503 })
  })
  const env = {
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_ANON_KEY: 'fixture-anon-key',
    ASSETS: {
      fetch: async (input: Request | URL | string): Promise<Response> => {
        const path = new URL(input instanceof Request ? input.url : input).pathname
        assets.push(path)
        if (path === '/index.html')
          return new Response(shell, { headers: { 'Content-Type': 'text/html' } })
        if (path === '/contact.html')
          return new Response(contactSource, { headers: { 'Content-Type': 'text/html' } })
        if (path === '/info.css' || path === '/tokens.css')
          return new Response(publicFile(path), { headers: { 'Content-Type': 'text/css' } })
        return new Response('Not found', { status: 404 })
      },
    },
  }
  const response = await worker.fetch(
    new Request('https://bladeblendstudio.se/contact', { method }),
    env,
    noPublicContent,
  )
  return { response, body: await response.text(), rpcs: rpcs.sort(), assets: assets.sort() }
}

describe('the reads behind /contact', () => {
  afterEach(() => vi.restoreAllMocks())

  it('serves the static Contact of a pre-Contact publication without reading the publication', async () => {
    const presentation = revision56()
    expect(presentation.pages.map((page) => page.path)).not.toContain('/contact')
    expect(JSON.stringify(presentation).length).toBeGreaterThan(1_000_000)
    const { response, body, rpcs, assets } = await requestContact(presentation, 'GET')
    expect(response.status).toBe(200)
    expect(body).not.toContain('data-cms-public="1"')
    expect(body).toContain('Aktuell Salong')
    expect(rpcs).toEqual(['public_business_discovery', 'public_cms_page_metadata'])
    expect(assets).toEqual(['/contact.html'])
  })

  it('answers HEAD for a pre-Contact publication from one bounded lookup', async () => {
    const { response, body, rpcs, assets } = await requestContact(revision56(), 'HEAD')
    expect(response.status).toBe(200)
    expect(body).toBe('')
    expect(response.headers.get('Link')).toBe('</llms.txt>; rel="describedby"')
    expect(rpcs).toEqual(['public_cms_page_metadata'])
    expect(assets).toEqual(['/contact.html'])
  })

  it('answers HEAD for a published Contact from one bounded lookup, rendering nothing', async () => {
    const presentation = revision56()
    presentation.pages.push(contact)
    const { response, body, rpcs, assets } = await requestContact(presentation, 'HEAD')
    expect(response.status).toBe(200)
    expect(body).toBe('')
    expect(response.headers.get('Link')).toBe('</llms.txt>; rel="describedby"')
    expect(response.headers.get('Vary')).toContain('Accept')
    expect(rpcs).toEqual(['public_cms_page_metadata'])
    expect(assets).toEqual(['/index.html'])
  })

  // Not a bound: rendering needs the page, themes and fonts, which no bounded RPC returns yet.
  it('renders a published Contact on GET from one whole-publication read (current-state control)', async () => {
    const presentation = revision56()
    presentation.pages.push(contact)
    const { response, body, rpcs } = await requestContact(presentation, 'GET')
    expect(response.status).toBe(200)
    expect(body).toContain('data-cms-public="1"')
    expect(body).toContain('<h1 id="contact-title">Kontakta Aktuell Salong</h1>')
    expect(rpcs.filter((rpc) => rpc === 'public_cms_presentation')).toHaveLength(1)
  })
})
