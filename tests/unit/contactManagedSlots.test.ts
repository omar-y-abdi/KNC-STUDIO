import { readFileSync } from 'node:fs'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emptyDocument,
  validateCompleteDocument,
  validateDocumentMedia,
  type CmsDocument,
} from '../../shared/cms'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup'
import worker from '../../src/worker'

// G09 (PR #104 final gate): a Contact body carrying data-business-contact-page="1" is the managed
// template, and the Worker refills its five server-owned slots on every request
// (src/site/businessSlots.ts fillSlots). Publication must accept such a body only when every slot is
// present and each one can be refilled: no slot inside another slot (the outer refill erases it),
// one slot per element (only the first is refilled), and an element whose content the browser keeps
// after the refill (a void element drops it; a <p> pushes a refilled <dl> out of itself). Unmarked
// historical Contact bodies keep their earlier contract.

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.invalid',
  builtAssets: CMS_BUILT_ASSETS,
}
const source = readFileSync(new URL('../../public/contact.html', import.meta.url), 'utf8')
const shipped = source.slice(source.indexOf('<body>') + '<body>'.length, source.indexOf('</body>'))
const english = readFileSync(
  new URL('../../src/admin/cms/contact.en.html', import.meta.url),
  'utf8',
).trim()

/** Replace exactly one occurrence of `find`, so an edit never silently misses the template. */
function edit(html: string, find: string, replacement: string): string {
  const at = html.indexOf(find)
  if (at < 0 || html.indexOf(find, at + 1) >= 0)
    throw new Error(`The Contact template must contain ${find} exactly once`)
  return html.slice(0, at) + replacement + html.slice(at + find.length)
}
const DETAILS_OPEN = '<div id="contact-details">'
const DETAILS_CLOSE = '</dl>\n        </div>'
const HOURS =
  '<div id="contact-hours" data-business-hours>\n          <p>Se aktuella tider i <a href="/booking">bokningen</a> eller kontakta salongen.</p>\n        </div>'
const TITLE = '<h1 id="contact-title">Kontakta Blade &amp; Blend Studio</h1>'

/** Swedish template variants; `null` when publication must accept it, else Edge's rejection. */
const VARIANTS: readonly (readonly [string, (html: string) => string, string | null])[] = [
  ['the shipped template', (html) => html, null],
  [
    'its title on an h2',
    (html) => edit(html, TITLE, '<h2 id="contact-title">Kontakta Blade &amp; Blend Studio</h2>'),
    null,
  ],
  [
    'its details in a section',
    (html) =>
      edit(
        edit(html, DETAILS_OPEN, '<section id="contact-details">'),
        DETAILS_CLOSE,
        '</dl>\n        </section>',
      ),
    null,
  ],
  [
    'its title renamed',
    (html) => edit(html, 'id="contact-title"', 'id="custom-heading"'),
    'presentation./contact.sv: Contact page is missing required server-owned slot(s): #contact-title',
  ],
  [
    'its hours inside its details',
    (html) =>
      edit(
        edit(html, HOURS, ''),
        DETAILS_CLOSE,
        '</dl><div id="contact-hours"></div>\n        </div>',
      ),
    'presentation./contact.sv: Contact page server-owned slot #contact-hours is inside slot #contact-details',
  ],
  [
    'its name inside its title',
    (html) =>
      edit(
        html,
        TITLE,
        '<h1 id="contact-title">Kontakta <span data-business-name>Blade &amp; Blend Studio</span></h1>',
      ),
    'presentation./contact.sv: Contact page server-owned slot [data-business-name] is inside slot #contact-title',
  ],
  [
    'its name and city on one element',
    (html) =>
      edit(
        edit(html, '<span data-business-city>Göteborg</span>', 'Göteborg'),
        '<span data-business-name>',
        '<span data-business-name data-business-city>',
      ),
    'presentation./contact.sv: Contact page element holds several server-owned slots: [data-business-name], [data-business-city]',
  ],
  [
    'its details on a paragraph',
    (html) =>
      edit(
        edit(html, DETAILS_OPEN, '<p id="contact-details">'),
        DETAILS_CLOSE,
        '</dl>\n        </p>',
      ),
    'presentation./contact.sv: Contact page server-owned slot #contact-details cannot be filled in <p>',
  ],
  [
    'its title on a void element',
    (html) => edit(html, TITLE, '<hr id="contact-title">'),
    'presentation./contact.sv: Contact page server-owned slot #contact-title cannot be filled in <hr>',
  ],
]

function contactDocument(sv: string, en = english): CmsDocument {
  const document = emptyDocument()
  document.presentation.pages = [
    {
      id: '10000000-0000-4000-8000-000000000007',
      kind: 'page',
      path: '/contact',
      name: { sv: 'Kontakt', en: 'Contact' },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: false,
      content: {
        sv: { html: sv, css: { light: '', dark: '' } },
        en: { html: en, css: { light: '', dark: '' } },
      },
    },
  ]
  return document
}

/** Edge's publication sequence (supabase/functions/cms-studio): null, or the rejection message. */
function publicationRejection(document: CmsDocument): string | null {
  try {
    validateCompleteDocument(document, document)
    const placements = validateDocumentMarkupPlacements(document, policy)
    validateDocumentMedia(document, [], placements)
    validateCompleteDocument(document, document)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('managed Contact publication', () => {
  it.each(VARIANTS)('validates a marked Contact with %s', (_label, variant, rejection) => {
    expect(publicationRejection(contactDocument(variant(shipped)))).toBe(rejection)
  })

  it('keeps an unmarked historical Contact with nested or shared slots publishable', () => {
    const historical = (html: string): string => edit(html, ' data-business-contact-page="1"', '')
    for (const [label, variant] of VARIANTS) {
      const sv = historical(variant(shipped))
      expect(publicationRejection(contactDocument(sv, historical(english))), label).toBeNull()
    }
  })
})

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const elements = (node: Node): Element[] => [
  ...('tagName' in node ? [node] : []),
  ...('childNodes' in node ? node.childNodes.flatMap(elements) : []),
]
const has = (element: Element, name: string): boolean =>
  element.attrs.some((item) => item.name === name)
const id = (element: Element): string | undefined =>
  element.attrs.find((item) => item.name === 'id')?.value
const text = (node: Node): string =>
  'value' in node && node.nodeName === '#text'
    ? node.value
    : 'childNodes' in node
      ? node.childNodes.map(text).join('')
      : ''

const discovery = {
  settings: {
    business_name: 'Gate name',
    business_street: 'Grindgatan 1',
    business_postal_code: '123 45',
    business_city: 'Gatestad',
    business_phone_display: '040-123 45 67',
    business_phone_tel: '+46401234567',
    business_email: 'gate@example.test',
  },
  barbers: [{ id: '20000000-0000-4000-8000-000000000001', name: 'Barberare' }],
  services: [],
  schedules: [
    { barber_id: '20000000-0000-4000-8000-000000000001', weekday: 1, start_min: 600, end_min: 720 },
  ],
}
const shell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const publicFile = (path: string): string =>
  readFileSync(new URL(`../../public${path}`, import.meta.url), 'utf8')
const env = {
  SUPABASE_URL: 'https://fixture.invalid',
  SUPABASE_ANON_KEY: 'fixture-anon-key',
  ASSETS: {
    fetch: async (input: Request | URL | string): Promise<Response> => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === '/index.html')
        return new Response(shell, { headers: { 'Content-Type': 'text/html' } })
      if (path === '/info.css' || path === '/tokens.css')
        return new Response(publicFile(path), { headers: { 'Content-Type': 'text/css' } })
      return new Response('Not found', { status: 404 })
    },
  },
}
const noPublicContent = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}

/** The slots the Worker refilled from Företag & SEO and the schedule, as a browser parses them. */
async function servedSlots(document: CmsDocument): Promise<readonly string[]> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/rpc/public_cms_presentation')
      ? Response.json({ revision: 7, presentation: document.presentation })
      : String(input).endsWith('/rpc/public_business_discovery')
        ? Response.json(discovery)
        : new Response(null, { status: 503 }),
  )
  const response = await worker.fetch(
    new Request('https://bladeblendstudio.se/contact'),
    env,
    noPublicContent,
  )
  expect(response.status).toBe(200)
  const all = elements(parse(await response.text()))
  const inside = (slot: string): Element | undefined => all.find((element) => id(element) === slot)
  const spans = (name: string): readonly Element[] => all.filter((element) => has(element, name))
  const details = inside('contact-details')
  const hours = inside('contact-hours')
  return [
    ...(inside('contact-title') && text(inside('contact-title') as Element) === 'Kontakta Gate name'
      ? ['#contact-title']
      : []),
    ...(spans('data-business-name').length > 0 &&
    spans('data-business-name').every((element) => text(element) === 'Gate name')
      ? ['[data-business-name]']
      : []),
    ...(spans('data-business-city').length > 0 &&
    spans('data-business-city').every((element) => text(element) === 'Gatestad')
      ? ['[data-business-city]']
      : []),
    ...(details && text(details).includes('Grindgatan 1, 123 45 Gatestad')
      ? ['#contact-details']
      : []),
    ...(hours && text(hours).includes('10:00–12:00') ? ['#contact-hours'] : []),
  ]
}

describe('managed Contact rendering', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refills every server-owned slot of every marked Contact publication accepts', async () => {
    const all = [
      '#contact-title',
      '[data-business-name]',
      '[data-business-city]',
      '#contact-details',
      '#contact-hours',
    ]
    const incomplete: string[] = []
    for (const [label, variant] of VARIANTS) {
      const document = contactDocument(variant(shipped))
      if (publicationRejection(document) !== null) continue
      const filled = await servedSlots(document)
      vi.restoreAllMocks()
      const missing = all.filter((slot) => !filled.includes(slot))
      if (missing.length > 0) incomplete.push(`${label}: ${missing.join(', ')}`)
    }
    expect(incomplete).toEqual([])
  })
})
