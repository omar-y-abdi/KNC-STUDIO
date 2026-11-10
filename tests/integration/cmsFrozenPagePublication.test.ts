import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  readAdminStackEnv,
  signedInClient,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  type AdminStackEnv,
} from './_adminHelpers'
import { withClient } from './_helpers'
import type { CmsDocument, CmsPage, CmsState } from '../../packages/content-contracts/src/cms'
import { dropFrozenChrome } from '../../packages/content-contracts/src/site-page'

// Real Edge, PostgREST and Postgres: cms-studio refuses to publish a created page in the format
// that predates the live header, while it still validates and reads one, so the Studio can migrate
// it and publish the result.
let env: AdminStackEnv
let ownerToken = ''
let ownerId = ''
let original: CmsDocument
const origin = 'http://127.0.0.1:4173'
const PAGE = '7f000000-0000-4000-8000-00000000000f'
const PATH = '/it-fryst'
const BODY = '<main id="owner"><h1 id="owner-title">Villkor</h1><p>Ägarens text</p></main>'
const SHELL = `<div id="cms-site-shell"><header id="cms-site-header"><div><a class="cms-site-action-language" href="${PATH}?lang=en&amp;mode=light">EN</a></div></header><nav id="cms-site-menu" aria-label="Sidmeny"><a href="/?lang=sv&amp;mode=light">Hem</a></nav><div id="cms-site-content">${BODY}</div><footer id="cms-site-footer"><a href="/privacy">Integritetspolicy</a></footer></div>`
const SHELL_CSS =
  '[id="cms-site-shell"]{min-height:100vh}[id="cms-site-header"]>div{padding:16px}#owner-title{color:#123456}'

function page(html: string, css: string, layout?: 'independent'): CmsPage {
  const variant = () => ({ html, css: { light: css, dark: css } })
  return {
    id: PAGE,
    kind: 'page',
    path: PATH,
    inMenu: false,
    name: { sv: 'Fryst sida', en: 'Frozen page' },
    title: { sv: 'Fryst sida', en: 'Frozen page' },
    description: { sv: '', en: '' },
    content: { sv: variant(), en: variant() },
    ...(layout ? { layout } : {}),
  }
}
const FROZEN: readonly (readonly [string, () => CmsPage])[] = [
  ['the layout flag around frozen shell markup', () => page(SHELL, SHELL_CSS, 'independent')],
  ['the layout flag alone', () => page(BODY, '', 'independent')],
  ['frozen shell markup without the flag', () => page(SHELL, SHELL_CSS)],
  [
    'an own element with id="cms-site-shell"',
    () => page(BODY.replace('id="owner"', 'id="cms-site-shell"'), ''),
  ],
]

async function call(body: unknown): Promise<Response> {
  return fetch(`${env.url}/functions/v1/cms-studio`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${ownerToken}`,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function state(): Promise<CmsState> {
  const response = await call({ operation: 'state' })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()) as CmsState
}

const withPage = (document: CmsDocument, value: CmsPage): CmsDocument => {
  const next = structuredClone(document)
  next.presentation.pages = [
    ...next.presentation.pages.filter((item) => item.id !== value.id),
    value,
  ]
  return next
}
const stored = (document: CmsDocument): CmsPage | undefined =>
  document.presentation.pages.find((item) => item.id === PAGE)

const publication = (base: CmsState, document: CmsDocument) => ({
  operation: 'publish',
  baseRevision: base.revision,
  baseFingerprint: base.fingerprint,
  requestId: crypto.randomUUID(),
  document,
})

async function expectRefused(response: Response): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(422)
  const body = (await response.json()) as { error: string; message: string }
  expect(body.error).toBe('invalid_content')
  expect(body.message).toMatch(
    new RegExp(
      `^presentation\\.${PATH}: Sidan har ett element med id cms-site-shell eller är sparad i ett äldre format`,
    ),
  )
}

beforeAll(async () => {
  const configured = readAdminStackEnv()
  if (
    !configured ||
    !['localhost', '127.0.0.1'].includes(new URL(configured.url).hostname) ||
    !['localhost', '127.0.0.1'].includes(new URL(configured.dbUrl).hostname)
  )
    throw new Error(
      'CMS integration requires an isolated local Supabase stack; remote testing is forbidden.',
    )
  env = configured
  const owner = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)
  const session = (await owner.auth.getSession()).data.session
  if (!session) throw new Error('Missing authenticated owner identity')
  ownerToken = session.access_token
  ownerId = session.user.id
  original = (await state()).document
}, 60_000)

// Later integration files and the customer browsers share this stack.
afterAll(async () => {
  if (!original) return
  const response = await call(publication(await state(), original))
  expect(response.status, await response.clone().text()).toBe(200)
})

describe.sequential('CMS publication of a created page in the frozen format', () => {
  it.each(FROZEN)('refuses %s and writes nothing', async (_shape, frozen) => {
    const base = await state()
    await expectRefused(await call(publication(base, withPage(base.document, frozen()))))
    const after = await state()
    expect(after.revision).toBe(base.revision)
    expect(stored(after.document)).toBeUndefined()
  })

  it.each(FROZEN)('still validates %s, as a JSON import sends it', async (_shape, frozen) => {
    const document = withPage((await state()).document, frozen())
    const response = await call({ operation: 'validate', document })
    expect(response.status, await response.clone().text()).toBe(200)
    const checked = ((await response.json()) as { document: CmsDocument }).document
    expect(stored(checked)).toEqual(frozen())
  })

  it('reads a head and a revision stored before the rule, refuses them unchanged, and publishes the migrated page', async () => {
    // The database function is the only writer of the head. Called directly it stores the page as
    // a cms-studio without the rule stored it.
    const base = await state()
    const frozen = page(SHELL, SHELL_CSS, 'independent')
    await withClient(env.dbUrl, (client) =>
      client.query(
        'select public.internal_cms_publish($1::uuid, $2::jsonb, $3::bigint, $4, $5::uuid)',
        [
          ownerId,
          JSON.stringify(withPage(base.document, frozen)),
          base.revision,
          base.fingerprint,
          crypto.randomUUID(),
        ],
      ),
    )
    const head = await state()
    expect(head.revision).toBe(base.revision + 1)
    expect(stored(head.document)).toEqual(frozen)
    const read = await call({ operation: 'revision', revision: head.revision })
    expect(read.status, await read.clone().text()).toBe(200)
    expect(stored(((await read.json()) as CmsState).document)).toEqual(frozen)

    await expectRefused(await call(publication(head, head.document)))
    expect((await state()).revision).toBe(head.revision)

    // The Studio's adoption step for this page (normalizeDocument runs dropFrozenChrome).
    const migrated = withPage(head.document, dropFrozenChrome(frozen))
    const response = await call(publication(head, migrated))
    expect(response.status, await response.clone().text()).toBe(200)
    const published = stored((await state()).document)
    expect(published && 'layout' in published).toBe(false)
    expect(published?.content.sv).toEqual({
      html: BODY,
      css: { light: '#owner-title{color:#123456}', dark: '#owner-title{color:#123456}' },
    })
  })
})
