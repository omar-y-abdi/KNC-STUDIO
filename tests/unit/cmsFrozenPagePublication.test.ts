import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyDocument,
  type CmsDocument,
  type CmsPage,
} from '../../packages/content-contracts/src/cms'
import { createSitePage, isFrozenSitePage } from '../../packages/content-contracts/src/site-page'
import { restoreRevision } from '../../modules/studio/src/draft'
import { normalizeDocument } from '../../modules/studio/src/normalizeDocument'

// The real cms-studio handler over a stand-in database: publication refuses a created page in the
// frozen format, while validation (JSON import, locked preview) and a stored revision still give
// the Studio the document, whose migrated result publishes.
const boundary = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.createClient }))

const OWNER = '30000000-0000-4000-8000-000000000001'
const FINGERPRINT = '0'.repeat(32)
const REFUSAL =
  'presentation./vilkor: Sidan har ett element med id cms-site-shell eller är sparad i ett äldre format med en egen kopia av sidhuvudet. Byt elementets id, eller ladda om Studion så att sidan konverteras, och publicera igen.'

let handler: (request: Request) => Promise<Response>
let head: CmsDocument
let revisions: Map<number, CmsDocument>
let published: CmsDocument[]

beforeEach(async () => {
  vi.resetModules()
  head = emptyDocument()
  revisions = new Map()
  published = []
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === 'internal_cms_assert_owner' || name === 'internal_cms_check_media')
      return { data: null, error: null }
    if (name === 'internal_cms_missing_media') return { data: [], error: null }
    if (name === 'internal_cms_state')
      return {
        data: { revision: 57, fingerprint: FINGERPRINT, assets: [], document: head },
        error: null,
      }
    if (name === 'internal_cms_revision') {
      const document = revisions.get(Number(args['p_revision']))
      return { data: document ? { revision: args['p_revision'], document } : null, error: null }
    }
    if (name === 'internal_cms_publish') {
      const document = args['p_document'] as CmsDocument
      published.push(document)
      return {
        data: {
          document,
          revision: 58,
          fingerprint: FINGERPRINT,
          requestId: args['p_request_id'],
        },
        error: null,
      }
    }
    throw new Error(`Unexpected RPC ${name}`)
  }
  boundary.createClient.mockReset().mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) },
    rpc,
  })
  const config: Record<string, string> = {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
  }
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => config[name] },
    serve: (callback: typeof handler) => {
      handler = callback
    },
  })
  // Deno entrypoints have a separate type-check gate; this exercises their HTTP boundary in Node.
  await vi.importActual('../../supabase/functions/cms-studio/index.ts')
})
afterEach(() => vi.unstubAllGlobals())

function call(body: Record<string, unknown>): Promise<Response> {
  return handler(
    new Request('https://edge.example.test/cms-studio', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer owner-session',
        origin: 'https://bladeblendstudio.se',
      },
      body: JSON.stringify(body),
    }),
  )
}
const publish = (document: CmsDocument): Promise<Response> =>
  call({
    operation: 'publish',
    document,
    baseRevision: 57,
    baseFingerprint: FINGERPRINT,
    requestId: crypto.randomUUID(),
  })

const live = (path = '/vilkor'): CmsPage =>
  createSitePage({
    id: '20000000-0000-4000-8000-0000000000f1',
    path,
    name: { sv: 'Villkor', en: 'Terms' },
  })
const BODY = '<main id="owner"><h1 id="owner-title">Villkor</h1><p>Ägarens text</p></main>'
// The format production revisions 52 to 54 hold for /vilkor: the flag, the shell around a frozen
// header copy, and the attribute-form id selectors that Studio wrote.
const SHELL = `<div id="cms-site-shell"><header id="cms-site-header"><div><a class="cms-site-action-language" href="/vilkor?lang=en&amp;mode=light">EN</a></div></header><nav id="cms-site-menu" aria-label="Sidmeny"><a href="/?lang=sv&amp;mode=light">Hem</a></nav><div id="cms-site-content">${BODY}</div><footer id="cms-site-footer"><a href="/privacy">Integritetspolicy</a></footer></div>`
const SHELL_CSS =
  '[id="cms-site-shell"]{min-height:100vh}[id="cms-site-header"]>div{padding:16px}#owner-title{color:#123456}'
function shelled(): CmsPage {
  const variant = () => ({ html: SHELL, css: { light: SHELL_CSS, dark: SHELL_CSS } })
  return { ...live(), content: { sv: variant(), en: variant() } }
}
function ownElement(): CmsPage {
  const page = live()
  for (const lang of ['sv', 'en'] as const)
    page.content[lang].html = page.content[lang].html.replace(
      /<main id="[^"]*"/,
      '<main id="cms-site-shell"',
    )
  return page
}
const FROZEN: readonly (readonly [string, () => CmsPage])[] = [
  ['the layout flag around frozen shell markup', () => ({ ...shelled(), layout: 'independent' })],
  ['the layout flag alone', () => ({ ...live(), layout: 'independent' })],
  ['frozen shell markup without the flag', shelled],
  ['an own element with id="cms-site-shell"', ownElement],
]
const withPage = (page: CmsPage): CmsDocument => {
  const document = emptyDocument()
  document.presentation.pages.push(page)
  return document
}
const vilkor = (document: CmsDocument): CmsPage => {
  const page = document.presentation.pages.find((item) => item.path === '/vilkor')
  if (!page) throw new Error('The created page was lost')
  return page
}

describe.each(FROZEN)('a created page stored with %s', (_shape, frozen) => {
  it('is refused by publication and nothing is written', async () => {
    expect(isFrozenSitePage(frozen())).toBe(true)
    const response = await publish(withPage(frozen()))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_content',
      message: REFUSAL,
      requestId: expect.any(String),
    })
    expect(published).toEqual([])
  })

  it('still passes import validation and a revision read, migrates in the Studio, and then publishes', async () => {
    const stored = withPage(frozen())
    revisions.set(53, structuredClone(stored))
    const validated = await call({ operation: 'validate', document: stored })
    expect(validated.status).toBe(200)
    const checked = ((await validated.json()) as { document: CmsDocument }).document
    expect(checked).toEqual(stored)
    const read = await call({ operation: 'revision', revision: 53 })
    expect(read.status).toBe(200)
    const old = ((await read.json()) as { document: CmsDocument }).document
    expect(old).toEqual(stored)
    for (const adopted of [
      normalizeDocument(checked),
      normalizeDocument(restoreRevision(old, head).document),
    ]) {
      expect(isFrozenSitePage(vilkor(adopted))).toBe(false)
      expect('layout' in vilkor(adopted)).toBe(false)
      const response = await publish(adopted)
      expect(response.status).toBe(200)
      expect(published.at(-1)).toEqual(adopted)
    }
    expect(published).toHaveLength(2)
  })
})

it('keeps the owner body and its paint when a page in the stored /vilkor format migrates', () => {
  const page = vilkor(normalizeDocument(withPage({ ...shelled(), layout: 'independent' })))
  for (const lang of ['sv', 'en'] as const)
    expect(page.content[lang]).toEqual({
      html: BODY,
      css: { light: '#owner-title{color:#123456}', dark: '#owner-title{color:#123456}' },
    })
})

it('publishes a created page in the current format', async () => {
  const document = withPage(live())
  const response = await publish(document)
  expect(response.status).toBe(200)
  expect(published).toEqual([document])
})

it('publishes Contact with the layout flag: only created pages have a frozen format', async () => {
  const body = { html: '<main><h1>Kontakt</h1></main>', css: { light: '', dark: '' } }
  const contact: CmsPage = {
    ...live('/contact'),
    layout: 'independent',
    content: { sv: body, en: body },
  }
  const document = withPage(contact)
  const response = await publish(document)
  expect(response.status).toBe(200)
  expect(published).toEqual([document])
})
