import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  readAdminStackEnv,
  signedInClient,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  BARBER_EMAIL,
  BARBER_PASSWORD,
  type AdminStackEnv,
} from './_adminHelpers'
import { withClient } from './_helpers'
import { validateDocument, defaultEmailDesign, type CmsState } from '../../shared/cms'

let env: AdminStackEnv, owner: SupabaseClient, barber: SupabaseClient, service: SupabaseClient
let ownerToken = '',
  barberToken = '',
  ownerId = ''
const origin = 'http://127.0.0.1:4173'
async function call(body: unknown, token = ownerToken): Promise<Response> {
  return fetch(`${env.url}/functions/v1/cms-studio`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${token}`,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
async function state(): Promise<CmsState> {
  const result = await call({ operation: 'state' })
  if (result.status !== 200) {
    const profile = await withClient(env.dbUrl, (db) =>
      db.query(
        'select role,account_enabled,must_change_password from public.profiles where id=$1',
        [ownerId],
      ),
    )
    const identity = await service.auth.getUser(ownerToken)
    const rpc = await service.rpc('internal_cms_state', { p_actor: ownerId })
    console.error(
      'CMS_STATE_DIAGNOSTIC',
      JSON.stringify({
        profile: profile.rows[0],
        identityMatches: identity.data.user?.id === ownerId,
        rpcCode: rpc.error?.code,
        rpcMessage: rpc.error?.message,
      }),
    )
  }
  expect(result.status, await result.clone().text()).toBe(200)
  const value = (await result.json()) as CmsState
  validateDocument(value.document)
  return value
}
const publication = (base: CmsState, document = structuredClone(base.document)) => ({
  operation: 'publish',
  baseRevision: base.revision,
  baseFingerprint: base.fingerprint,
  requestId: crypto.randomUUID(),
  document,
})
async function upload(
  kind: string,
  token = ownerToken,
  bytes: Uint8Array = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=',
    'base64',
  ),
): Promise<Response> {
  const form = new FormData()
  form.set('kind', kind)
  form.set('file', new File([new Uint8Array(bytes)], 'fixture.png', { type: 'image/png' }))
  if (kind === 'cms_asset') form.set('purpose', 'library')
  else {
    form.set('galleryKind', 'salon')
    form.set('alt', 'Legacy fixture')
    form.set('sortOrder', '0')
  }
  return fetch(`${env.url}/functions/v1/upload-image`, {
    method: 'POST',
    headers: { apikey: env.anonKey, authorization: `Bearer ${token}`, origin },
    body: form,
  })
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
  owner = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)
  barber = await signedInClient(env, BARBER_EMAIL, BARBER_PASSWORD)
  service = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const first = (await owner.auth.getSession()).data.session,
    second = (await barber.auth.getSession()).data.session
  if (!first || !second) throw new Error('Missing authenticated integration identities')
  ownerToken = first.access_token
  barberToken = second.access_token
  ownerId = first.user.id
}, 30000)

describe.sequential('real CMS Edge, Auth and database boundary', () => {
  it('rejects anonymous and barber requests without exposing the owner document', async () => {
    expect((await call({ operation: 'state' }, env.anonKey)).status).toBe(401)
    expect((await call({ operation: 'state' }, barberToken)).status).toBe(403)
    const bypass = await owner.rpc('internal_cms_state', { p_actor: ownerId })
    expect(bypass.error).not.toBeNull()
  })
  it('rechecks account status and the forced-password gate at the server', async () => {
    try {
      await withClient(env.dbUrl, (db) =>
        db.query('update public.profiles set must_change_password=true where id=$1', [ownerId]),
      )
      expect((await call({ operation: 'state' })).status).toBe(403)
      await withClient(env.dbUrl, (db) =>
        db.query(
          'update public.profiles set must_change_password=false,account_enabled=false where id=$1',
          [ownerId],
        ),
      )
      expect((await call({ operation: 'state' })).status).toBe(403)
    } finally {
      await withClient(env.dbUrl, (db) =>
        db.query(
          'update public.profiles set must_change_password=false,account_enabled=true where id=$1',
          [ownerId],
        ),
      )
    }
  })
  it('rejects incomplete publications before omission can delete authoritative content', async () => {
    const base = await state()
    const attempts: Array<{ name: string; document: CmsState['document'] }> = []

    const missingSetting = structuredClone(base.document)
    delete missingSetting.settings['business_name']
    attempts.push({ name: 'required setting', document: missingSetting })

    const missingTemplate = structuredClone(base.document)
    missingTemplate.emails = missingTemplate.emails.filter(
      (email) => !(email.template === 'customer_confirmation' && email.lang === 'sv'),
    )
    attempts.push({ name: 'required email variant', document: missingTemplate })

    const missingSiteTranslation = structuredClone(base.document)
    const siteEntry = Object.entries(missingSiteTranslation.site).find(([, value]) =>
      Object.hasOwn(value, 'sv'),
    )
    if (siteEntry) {
      delete siteEntry[1].sv
      attempts.push({ name: 'required site translation', document: missingSiteTranslation })
    }

    const missingAboutTranslation = structuredClone(base.document)
    const aboutEntry = Object.entries(missingAboutTranslation.about).find(([, value]) =>
      Object.hasOwn(value, 'en'),
    )
    if (aboutEntry) {
      delete aboutEntry[1].en
      attempts.push({ name: 'required about translation', document: missingAboutTranslation })
    }

    for (const attempt of attempts) {
      const validation = await call({ operation: 'validate', document: attempt.document })
      const validationDetail = await validation.clone().text()
      expect(validation.status, `${attempt.name} validate: ${validationDetail}`).toBe(422)

      const publish = await call(publication(base, attempt.document))
      const publishDetail = await publish.clone().text()
      expect(publish.status, `${attempt.name} publish: ${publishDetail}`).toBe(422)
    }

    expect(await state()).toEqual(base)
  })
  it('uses the same database semantics for validation and publication', async () => {
    const base = await state()
    const attempts: { name: string; document: CmsState['document'] }[] = []

    const oversizedSiteCopy = structuredClone(base.document)
    oversizedSiteCopy.site['kicker'] = { sv: 'x'.repeat(401), en: 'Valid' }
    attempts.push({ name: 'site content length', document: oversizedSiteCopy })

    const invalidEmail = structuredClone(base.document)
    invalidEmail.settings['business_email'] = 'not-an-email'
    attempts.push({ name: 'business email', document: invalidEmail })

    for (const attempt of attempts) {
      const validation = await call({ operation: 'validate', document: attempt.document })
      expect(
        validation.status,
        `${attempt.name} validate: ${await validation.clone().text()}`,
      ).toBe(422)
      const publish = await call(publication(base, attempt.document))
      expect(publish.status, `${attempt.name} publish: ${await publish.clone().text()}`).toBe(422)
    }

    const accepted = structuredClone(base.document)
    accepted.settings['business_email'] = 'cms-semantic@example.test'
    const validation = await call({ operation: 'validate', document: accepted })
    expect(validation.status, await validation.clone().text()).toBe(200)
    const validated = (await validation.json()) as { document: CmsState['document'] }
    const published = await call(publication(base, validated.document))
    expect(published.status, await published.clone().text()).toBe(200)

    const latest = await state()
    const restore = await call(publication(latest, base.document))
    expect(restore.status, await restore.clone().text()).toBe(200)
  })
  it('accepts exactly one competing publication and replays the committed identity', async () => {
    const base = await state()

    const first = publication(base)
    const second = publication(base)

    first.document.settings['business_email'] = 'cms-concurrent-first@example.test'
    second.document.settings['business_email'] = 'cms-concurrent-second@example.test'

    interface DirectPublishResult {
      data: unknown | null
      error: {
        code?: string
        message?: string
      } | null
    }

    const publishDirect = async (
      request: ReturnType<typeof publication>,
    ): Promise<DirectPublishResult> =>
      withClient(env.dbUrl, async (db) => {
        await db.query('begin')

        try {
          await db.query('set local role service_role')

          const result = await db.query<{ result: unknown }>(
            `
              select public.internal_cms_publish(
                $1::uuid,
                $2::jsonb,
                $3::bigint,
                $4::text,
                $5::uuid
              ) as result
            `,
            [
              ownerId,
              JSON.stringify(request.document),
              request.baseRevision,
              request.baseFingerprint,
              request.requestId,
            ],
          )

          await db.query('commit')

          return {
            data: result.rows[0]?.result ?? null,
            error: null,
          }
        } catch (reason) {
          await db.query('rollback')

          const error = reason as {
            code?: string
            message?: string
          }

          return {
            data: null,
            error: {
              code: error.code,
              message: error.message,
            },
          }
        }
      })

    /*
     * Test the actual concurrency boundary directly against PostgreSQL.
     *
     * Two separate DB connections are required here. Running the same race
     * through the local PostgREST container can leave one HTTP RPC request
     * hanging on macOS/Colima even though the database serialization contract
     * is the thing this assertion is intended to test.
     */
    const attempts = await Promise.all([publishDirect(first), publishDirect(second)])

    const successfulIndexes = attempts
      .map((attempt, index) => (attempt.error === null ? index : -1))
      .filter((index) => index !== -1)

    const conflicts = attempts.filter((attempt) => attempt.error?.code === '40001')

    expect(successfulIndexes).toHaveLength(1)
    expect(conflicts).toHaveLength(1)

    const winnerIndex = successfulIndexes[0]
    if (winnerIndex === undefined) throw new Error('No publication committed')

    const winner = winnerIndex === 0 ? first : second
    const committed = attempts[winnerIndex]?.data

    expect(committed).not.toBeNull()

    /*
     * HTTP/Edge path is still exercised, just not as the concurrency
     * transport. Reusing the winning request id must replay the same commit.
     */
    const replay = await call(winner)

    expect(replay.status, await replay.clone().text()).toBe(200)
    expect(await replay.json()).toEqual(committed)

    const sameIdDifferentContent = structuredClone(winner)
    sameIdDifferentContent.document.settings['business_email'] = 'different@example.test'

    expect((await call(sameIdDifferentContent)).status).toBe(422)

    const latest = await state()

    expect(latest.revision).toBe(base.revision + 1)

    const restore = await call(publication(latest, base.document))

    expect(restore.status, await restore.text()).toBe(200)
  })
  it('detects writes made through the retained legacy editor even without a CMS revision change', async () => {
    const base = await state()
    const legacy = await owner
      .from('site_settings')
      .update({ value: 'Changed through old editor' })
      .eq('key', 'business_name')
      .select('key,value')
      .single()

    expect(legacy.error).toBeNull()
    expect(legacy.data?.value).toBe('Changed through old editor')
    const stale = await call(publication(base))
    expect(stale.status).toBe(409)
    const latest = await state()
    expect(latest.revision).toBe(base.revision)
    expect(latest.document.settings['business_name']).toBe('Changed through old editor')
    expect((await call(publication(latest, base.document))).status).toBe(200)
  })
  it('rejects active markup without committing any content or history', async () => {
    const base = await state(),
      attempt = publication(base)
    attempt.document.presentation.pages.push({
      id: crypto.randomUUID(),
      kind: 'page',
      path: '/cms-unsafe-test',
      name: { sv: 'Unsafe', en: 'Unsafe' },
      title: { sv: 'Unsafe', en: 'Unsafe' },
      description: { sv: '', en: '' },
      inMenu: false,
      content: {
        sv: { html: '<script>alert(1)</script>', css: { light: '', dark: '' } },
        en: { html: '<p>Safe</p>', css: { light: '', dark: '' } },
      },
    })
    expect((await call(attempt)).status).toBe(422)
    expect(await state()).toEqual(base)
  })
  it('stores a decoded image in the library without assigning it to public content', async () => {
    const before = await state()
    const response = await upload('cms_asset')
    expect(response.status, await response.clone().text()).toBe(200)
    const value = (await response.json()) as {
      asset: {
        id: string
        bucket: string
        path: string
        mime: string
        width: number
        height: number
      }
    }
    expect(value.asset.mime).toBe('image/webp')
    expect(value.asset.width).toBeGreaterThan(0)
    const after = await state()
    expect(after.document).toEqual(before.document)
    expect(after.revision).toBe(before.revision)
    expect(after.assets.some((asset) => asset.id === value.asset.id)).toBe(true)
    const downloaded = await fetch(
      `${env.url}/storage/v1/object/public/${value.asset.bucket}/${value.asset.path}`,
    )
    expect(downloaded.status).toBe(200)
    expect(
      Buffer.from(await downloaded.arrayBuffer())
        .subarray(8, 12)
        .toString(),
    ).toBe('WEBP')
    const archive = await call({
      operation: 'asset',
      id: value.asset.id,
      version: 0,
      name: 'Library fixture',
      alt: 'Description',
      archived: true,
    })
    expect(archive.status).toBe(200)
    expect(
      (
        await call({
          operation: 'asset',
          id: value.asset.id,
          version: 0,
          name: 'Stale',
          alt: '',
          archived: false,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await call({
          operation: 'asset',
          id: value.asset.id,
          version: 1,
          name: 'Library fixture',
          alt: 'Description',
          archived: false,
        })
      ).status,
    ).toBe(200)
  }, 30000)
  it('rejects invalid image bytes and barber library writes before registering an asset', async () => {
    const before = await state()
    expect((await upload('cms_asset', ownerToken, new Uint8Array([1, 2, 3]))).status).toBe(422)
    expect((await upload('cms_asset', barberToken)).status).toBe(403)
    expect((await state()).assets).toEqual(before.assets)
  })
  it('rejects imported authored markup that assigns a font asset as an image', async () => {
    const response = await upload('cms_asset')
    expect(response.status, await response.clone().text()).toBe(200)
    const value = (await response.json()) as {
      asset: { id: string; bucket: 'cms-library'; path: string }
    }
    const changed = await service
      .from('cms_assets')
      .update({ mime: 'font/woff2' })
      .eq('id', value.asset.id)
    expect(changed.error).toBeNull()

    try {
      const base = await state()
      const imported = structuredClone(base.document)
      const src = `${env.url}/storage/v1/object/public/${value.asset.bucket}/${value.asset.path}`
      imported.presentation.regions['home-before'] = {
        sv: { html: `<img src="${src}" alt="Importtest">`, css: { light: '', dark: '' } },
        en: { html: `<img src="${src}" alt="Import test">`, css: { light: '', dark: '' } },
      }

      const validation = await call({ operation: 'validate', document: imported })
      expect(validation.status, await validation.clone().text()).toBe(422)
      const publish = await call(publication(base, imported))
      expect(publish.status, await publish.clone().text()).toBe(422)
      expect((await state()).document).toEqual(base.document)
    } finally {
      const restored = await service
        .from('cms_assets')
        .update({ mime: 'image/webp' })
        .eq('id', value.asset.id)
      expect(restored.error).toBeNull()
    }
  }, 30000)
  it('makes newly uploaded legacy media available to the new editor without a second migration', async () => {
    const before = await state(),
      response = await upload('gallery')
    expect(response.ok, await response.clone().text()).toBe(true)
    const after = await state()
    const newImage = after.document.gallery.find(
      (image) => !before.document.gallery.some((previous) => previous.id === image.id),
    )
    expect(newImage).toBeDefined()
    if (!newImage) throw new Error('Missing legacy gallery assignment')
    expect(
      after.assets.some(
        (asset) => asset.bucket === 'gallery' && asset.path === newImage.storage_path,
      ),
    ).toBe(true)

    const wrongPurpose = structuredClone(after.document)
    const reassigned = wrongPurpose.gallery.find((image) => image.id === newImage.id)
    if (!reassigned) throw new Error('Missing copied gallery assignment')
    reassigned.kind = 'cuts'
    const validation = await call({ operation: 'validate', document: wrongPurpose })
    expect(validation.status, await validation.clone().text()).toBe(422)
    const publish = await call(publication(after, wrongPurpose))
    expect(publish.status, await publish.clone().text()).toBe(422)
    expect((await state()).document).toEqual(after.document)

    const original = publication(after, before.document)
    expect((await call(original)).status).toBe(200)
  }, 30000)
  it('publishes actual email designs to the server-only delivery RPC and preserves old forms', async () => {
    const base = await state(),
      request = publication(base)
    const email = request.document.emails.find(
      (item) => item.template === 'customer_confirmation' && item.lang === 'sv',
    )
    if (!email) throw new Error('The seeded transactional email template is missing')
    email.subject = 'CMS mail integration'
    email.design = defaultEmailDesign()
    const result = await call(request)
    expect(result.status, await result.text()).toBe(200)
    const delivery = await service.rpc('email_template_for_delivery', {
      p_template: email.template,
      p_lang: email.lang,
    })
    expect(delivery.error).toBeNull()
    expect(delivery.data.subject).toBe('CMS mail integration')
    expect(delivery.data.design).toEqual(email.design)
    expect(
      (
        await owner.rpc('email_template_for_delivery', {
          p_template: email.template,
          p_lang: email.lang,
        })
      ).error,
    ).not.toBeNull()
    const legacy = await owner
      .from('email_templates')
      .update({ subject: 'Saved by old Mail tab' })
      .eq('template', email.template)
      .eq('lang', email.lang)
    expect(legacy.error).toBeNull()
    expect(
      (await state()).document.emails.find(
        (item) => item.template === email.template && item.lang === email.lang,
      )?.subject,
    ).toBe('Saved by old Mail tab')
    expect((await call(publication(await state(), base.document))).status).toBe(200)
  })
})
