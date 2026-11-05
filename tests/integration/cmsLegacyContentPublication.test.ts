import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  readAdminStackEnv,
  signedInClient,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  type AdminStackEnv,
} from './_adminHelpers'
import { withClient } from './_helpers'
import type { CmsDocument, CmsEmail, CmsState } from '../../packages/content-contracts/src/cms'

// Real Edge, PostgREST and Postgres. Before the authority migration the owner wrote site_content and
// email_templates directly: any site key, and mail copy limited only by the column lengths. These
// rows are written here by the superuser after every migration has run. The authority migration
// changes privileges only, so the persisted state equals what an owner stored through the retired
// policies. Studio publication is then the only writer, and it must complete both the owner's
// repair and an unrelated business edit.
let env: AdminStackEnv
let ownerToken = ''
let originalSubject = ''
let originalBusinessName = ''
const origin = 'http://127.0.0.1:4173'
const LEGACY_KEY = 'retired_banner'
const LEGACY_SUBJECT = 'Hej {first_name}'

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

async function publish(change: (document: CmsDocument) => void): Promise<Response> {
  const base = await state()
  const document = structuredClone(base.document)
  change(document)
  return call({
    operation: 'publish',
    baseRevision: base.revision,
    baseFingerprint: base.fingerprint,
    requestId: crypto.randomUUID(),
    document,
  })
}

async function expectRejected(response: Response, message: string): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(422)
  expect(await response.json()).toMatchObject({ error: 'invalid_content', message })
}

async function rows<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient(env.dbUrl, async (client) => (await client.query(query, values)).rows as T[])
}

const recoverySubject = (): Promise<{ subject: string }[]> =>
  rows("select subject from public.email_templates where template='auth_recovery' and lang='sv'")
const businessName = (): Promise<{ value: string }[]> =>
  rows("select value from public.site_settings where key='business_name'")

function recoverySv(document: CmsDocument): CmsEmail {
  const email = document.emails.find(
    (item) => item.template === 'auth_recovery' && item.lang === 'sv',
  )
  if (!email) throw new Error('The seeded auth_recovery sv template is missing')
  return email
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
  const [subject] = await recoverySubject()
  const [business] = await businessName()
  if (!subject || !business) throw new Error('Seeded recovery template or business name missing')
  originalSubject = subject.subject
  originalBusinessName = business.value
}, 60_000)

// The superuser restores every seeded or published value, also when a publication was rejected:
// later integration files and the customer browsers share this stack.
afterAll(async () => {
  if (!env) return
  await withClient(env.dbUrl, async (client) => {
    await client.query('delete from public.site_content where key=$1', [LEGACY_KEY])
    if (originalSubject)
      await client.query(
        "update public.email_templates set subject=$1 where template='auth_recovery' and lang='sv'",
        [originalSubject],
      )
    if (originalBusinessName)
      await client.query("update public.site_settings set value=$1 where key='business_name'", [
        originalBusinessName,
      ])
  })
})

describe.sequential('CMS publication with a placeholder the retired mail editor stored', () => {
  beforeAll(async () => {
    await rows(
      "update public.email_templates set subject=$1 where template='auth_recovery' and lang='sv'",
      [LEGACY_SUBJECT],
    )
  })

  afterAll(async () => {
    await rows(
      "update public.email_templates set subject=$1 where template='auth_recovery' and lang='sv'",
      [originalSubject],
    )
  })

  it('publishes an unrelated business edit and keeps the persisted copy unchanged', async () => {
    const response = await publish((document) => {
      document.settings['business_name'] = 'Legacy Mail Studio'
    })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await recoverySubject()).toEqual([{ subject: LEGACY_SUBJECT }])
    expect(await businessName()).toEqual([{ value: 'Legacy Mail Studio' }])
  }, 30_000)

  it('accepts the owner repair that removes the unsupported placeholder', async () => {
    const response = await publish((document) => {
      recoverySv(document).subject = 'Hej'
    })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await recoverySubject()).toEqual([{ subject: 'Hej' }])
  }, 30_000)

  it('still rejects a newly introduced unknown placeholder', async () => {
    await expectRejected(
      await publish((document) => {
        recoverySv(document).title = 'Hej {first_name}'
      }),
      'emails.auth_recovery.sv.title: Okänd platshållare {first_name}.',
    )
  }, 30_000)
})

describe.sequential('CMS publication with a site key the retired table writer stored', () => {
  beforeAll(async () => {
    await rows(
      `insert into public.site_content(key,lang,value) values($1,'sv','Gammal banner'),($1,'en','Old banner')
       on conflict(key,lang) do update set value=excluded.value`,
      [LEGACY_KEY],
    )
  })

  afterAll(async () => {
    await rows('delete from public.site_content where key=$1', [LEGACY_KEY])
  })

  it('does not offer a key the public site never reads to Studio', async () => {
    expect(Object.keys((await state()).document.site)).not.toContain(LEGACY_KEY)
  }, 30_000)

  it('removes the unread key with the next unrelated publication', async () => {
    const response = await publish((document) => {
      document.settings['business_name'] = 'Legacy Site Studio'
    })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await businessName()).toEqual([{ value: 'Legacy Site Studio' }])
    expect(await rows('select lang from public.site_content where key=$1', [LEGACY_KEY])).toEqual(
      [],
    )
  }, 30_000)

  it('still rejects a newly introduced unsupported site key', async () => {
    await expectRejected(
      await publish((document) => {
        document.site['new_banner'] = { sv: 'Ny banner', en: 'New banner' }
      }),
      'site.new_banner: Unsupported field',
    )
  }, 30_000)
})
