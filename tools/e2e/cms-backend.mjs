import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  documentMediaPlacements,
  emptyDocument,
  validateCompleteDocument,
} from '../../shared/cms.ts'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets.ts'
export async function nativeBackend(
  context,
  initialDocument = emptyDocument(),
  assets = [],
  base = process.env.BASE_URL ?? 'http://127.0.0.1:4188',
) {
  // The CMS fixture uses local APIs, not a real third-party challenge on HTTP localhost.
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.turnstile={render:()=>"test",remove:()=>{},reset:()=>{}}',
    }),
  )
  let document = globalThis.structuredClone(initialDocument)
  let revision = 1
  const writes = []
  const revisions = new Map([[revision, globalThis.structuredClone(document)]])
  const fingerprint = () => createHash('md5').update(JSON.stringify(document)).digest('hex')
  await context.route('**/api/cms/presentation', (route) =>
    route.fulfill({
      json: { revision, presentation: document.presentation },
    }),
  )
  await context.route('https://admin-harness.invalid/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'Access-Control-Allow-Origin': new URL(base).origin,
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    }
    const reply = (value, status = 200) => route.fulfill({ status, headers, json: value })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/functions/v1/cms-studio') {
      const body = request.postDataJSON()
      if (body.operation === 'state')
        return reply({ revision, fingerprint: fingerprint(), assets, document })
      if (body.operation === 'history')
        return reply(
          [...revisions.keys()].reverse().map((value) => ({
            revision: value,
            created_at: '2026-09-21T12:00:00Z',
            summary: 'Publicerat sidinnehåll',
          })),
        )
      if (body.operation === 'revision') return reply({ document: revisions.get(body.revision) })
      if (body.operation === 'asset_usage') {
        const asset = assets.find((item) => item.id === body.id)
        const currentReferences = asset
          ? documentMediaPlacements(document).filter(
              ({ ref }) => ref.bucket === asset.bucket && ref.path === asset.path,
            ).length
          : 0
        return reply({ currentReferences, historyReferences: 0 })
      }
      if (['validate', 'publish'].includes(body.operation)) {
        const candidate = globalThis.structuredClone(body.document)
        try {
          validateCompleteDocument(candidate, document)
          validateDocumentMarkupPlacements(candidate, {
            siteOrigin: new URL(base).origin,
            storageOrigin: 'https://admin-harness.invalid',
            builtAssets: CMS_BUILT_ASSETS,
          })
        } catch (error) {
          console.error('CMS_VALIDATION_ERROR', error)
          console.error(
            'CMS_PAGE_SIZES',
            candidate.presentation.pages.map((page) => ({
              path: page.path,
              sv: page.content.sv.html.length,
              en: page.content.en.html.length,
            })),
          )
          return reply({ message: error.message }, 422)
        }
        if (body.operation === 'validate') return reply({ document: candidate })
        assert.equal(body.baseRevision, revision)
        assert.equal(body.baseFingerprint, fingerprint())
        document = candidate
        revision++
        revisions.set(revision, globalThis.structuredClone(document))
        writes.push('publish')
        return reply({ document, revision, fingerprint: fingerprint(), requestId: body.requestId })
      }
      throw new Error(`Unexpected CMS request: ${body.operation}`)
    }
    if (path === '/rest/v1/rpc/public_business_discovery')
      return reply({ settings: document.settings, barbers: [], services: [], schedules: [] })
    if (path === '/rest/v1/rpc/public_booking_catalog') return reply({ barbers: [], services: [] })
    if (path === '/rest/v1/site_content') {
      const lang = new URL(request.url()).searchParams.get('lang')?.slice(3) ?? 'sv'
      return reply([{ key: 'kicker', lang, value: `KNC source ${lang}` }])
    }
    if (path.startsWith('/rest/v1/')) return reply([])
    writes.push(path)
    return reply({ error: 'not_available_in_preview' }, 403)
  })
  return {
    writes,
    get document() {
      return document
    },
  }
}
