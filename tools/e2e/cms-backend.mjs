import { routeApi } from './route-api.mjs'
import { createHash, randomUUID } from 'node:crypto'
import {
  CmsValidationError,
  documentMedia,
  documentMediaPlacements,
  emptyDocument,
  mediaKey,
  validateCompleteDocument,
  validateDocumentMedia,
} from '../../shared/cms.ts'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets.ts'

// A fake cms-studio and upload-image that answer like the real Edge functions and database:
// the same validators, registration and missing-media checks, the archived-media rule, 409 on a
// stale base or version, and request idempotency.
const STORAGE_ORIGIN = 'https://admin-harness.invalid'
const STORED_MEDIA =
  /\/storage\/v1\/object\/public\/(gallery|barber-photos|cms-library)\/([a-zA-Z0-9][a-zA-Z0-9_./-]{0,239})/g
const CONFLICT = {
  error: 'conflict',
  message: 'Innehållet har ändrats. Jämför med den senaste versionen innan du publicerar.',
}
const MISSING_MEDIA =
  'En refererad fil saknas eller är inte registrerad. Välj filen på nytt i biblioteket.'
const RULE_REJECTED = {
  error: 'invalid_content',
  message: 'Innehållet uppfyller inte databasens innehållsregler.',
}

const md5 = (value) => createHash('md5').update(JSON.stringify(value)).digest('hex')

// A cms_assets row with the columns internal_cms_state returns to the studio.
const registered = (asset) => ({ trashed_at: null, ...asset })

// Structured references and storage URLs in markup, as internal_cms_document_media reads them.
function storedReferences(document) {
  const refs = [
    ...documentMedia(document),
    ...[...JSON.stringify(document).matchAll(STORED_MEDIA)].map(([, bucket, path]) => ({
      bucket,
      path,
    })),
  ]
  return [...new Map(refs.map((ref) => [mediaKey(ref), ref])).values()]
}

// Production invariant: every file the published head references is registered.
function headAssets(document) {
  return storedReferences(document).map((ref) =>
    registered({
      id: randomUUID(),
      bucket: ref.bucket,
      path: ref.path,
      name: ref.path.split('/').at(-1),
      alt: '',
      mime: ref.path.endsWith('.woff2') ? 'font/woff2' : 'image/webp',
      width: null,
      height: null,
      bytes: 1,
      archived: false,
      version: 0,
    }),
  )
}

// Mirrors internal_cms_assert_media_publishable: structured placements per key, markup per asset
// against everything the head references. Returns the owner-facing rejection, if any.
function mediaRejection(candidate, candidateMarkup, head, assets) {
  const placementKey = (item) => `${item.placement} ${mediaKey(item.ref)}`
  const headPlacements = new Set(documentMediaPlacements(head).map(placementKey))
  const headReferences = new Set(storedReferences(head).map(mediaKey))
  const placed = [
    ...documentMediaPlacements(candidate).filter((item) => !headPlacements.has(placementKey(item))),
    ...candidateMarkup.filter((item) => !headReferences.has(mediaKey(item.ref))),
  ]
  for (const { ref } of placed) {
    const asset = assets.find((item) => mediaKey(item) === mediaKey(ref))
    if (!asset)
      return `Filen ${ref.path} finns inte i biblioteket. Välj den på nytt under Resurser.`
    if (asset.archived)
      return `${asset.mime.startsWith('image/') ? 'Bilden' : 'Filen'} ${asset.name} ${asset.trashed_at ? 'ligger i papperskorgen' : 'är arkiverad'} och kan inte läggas till på en ny plats. Återställ den under Resurser först.`
  }
  return null
}

function uploadedAsset(form) {
  const file = form.get('file')
  const purpose = String(form.get('purpose'))
  const font = file.name.toLowerCase().endsWith('.woff2') || file.type === 'font/woff2'
  const bucket =
    font || purpose === 'library'
      ? 'cms-library'
      : purpose === 'profile'
        ? 'barber-photos'
        : 'gallery'
  const prefix = font
    ? 'fonts'
    : purpose === 'library'
      ? 'images'
      : purpose === 'profile'
        ? String(form.get('barberId'))
        : purpose
  return registered({
    id: randomUUID(),
    bucket,
    path: `${prefix}/${randomUUID()}.${font ? 'woff2' : 'webp'}`,
    name: file.name,
    alt: '',
    mime: font ? 'font/woff2' : 'image/webp',
    width: font ? null : 1,
    height: font ? null : 1,
    bytes: file.size,
    archived: false,
    version: 0,
  })
}

/**
 * Options: `usages` overrides asset_usage per asset id; `delay` ({ operation, started, done })
 * holds the first matching request ('upload' for upload-image) until `done` resolves;
 * `objects` lists the storage objects ({ bucket, path }) that exist, by default one for every
 * registered asset.
 */
export async function nativeBackend(
  context,
  initialDocument = emptyDocument(),
  initialAssets = [],
  base = process.env.BASE_URL ?? 'http://127.0.0.1:4188',
  options = {},
) {
  // The CMS fixture uses local APIs, not a real third-party challenge on HTTP localhost.
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.turnstile={render:()=>"test",remove:()=>{},reset:()=>{}}',
    }),
  )
  // GrapesJS loads its default icon font from a CDN; the tests never reach it.
  await context.route('https://cdnjs.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  )
  let document = globalThis.structuredClone(initialDocument)
  let revision = 1
  const writes = []
  const requests = []
  const publications = new Map()
  const revisions = new Map([[revision, globalThis.structuredClone(document)]])
  const supplied = initialAssets.map(registered)
  let assets = [
    ...supplied,
    ...headAssets(document).filter(
      (asset) => !supplied.some((item) => mediaKey(item) === mediaKey(asset)),
    ),
  ]
  // storage.objects, kept apart from cms_assets: the registry row and the bytes can drift apart.
  const objects = new Set((options.objects ?? assets).map(mediaKey))
  const policy = {
    siteOrigin: new URL(base).origin,
    storageOrigin: STORAGE_ORIGIN,
    builtAssets: CMS_BUILT_ASSETS,
  }
  const fingerprint = () => md5(document)
  const usage = (asset) =>
    options.usages?.[asset.id] ?? {
      currentReferences: documentMediaPlacements(document).filter(
        ({ ref }) => mediaKey(ref) === mediaKey(asset),
      ).length,
      historyReferences: 0,
    }
  const hold = async (operation) => {
    if (options.delay?.operation !== operation) return
    options.delay.started.release()
    await options.delay.done.promise
  }
  // validate and publish share the Edge pipeline in cms-studio/index.ts; internal_cms_missing_media
  // requires both the registry row and the storage object.
  const validated = (body) => {
    const candidate = globalThis.structuredClone(body.document)
    validateCompleteDocument(candidate, document)
    const markup = validateDocumentMarkupPlacements(candidate, policy)
    validateDocumentMedia(candidate, assets, markup)
    const registeredKeys = new Set(assets.map(mediaKey))
    const references = [...documentMedia(candidate), ...markup.map(({ ref }) => ref)]
    if (references.some((ref) => !registeredKeys.has(mediaKey(ref)) || !objects.has(mediaKey(ref))))
      throw new CmsValidationError('media', MISSING_MEDIA)
    validateCompleteDocument(candidate, document)
    return { candidate, markup }
  }
  const rejected = (message) => ({ status: 422, value: { error: 'invalid_content', message } })
  // internal_cms_publish order: request replay, stale base, archived-media rule, write.
  const publish = (body, { candidate, markup }) => {
    const previous = publications.get(body.requestId)
    if (previous)
      return previous.request === md5(candidate)
        ? { value: previous.response }
        : { status: 422, value: RULE_REJECTED }
    if (body.baseRevision !== revision || body.baseFingerprint !== fingerprint())
      return { status: 409, value: CONFLICT }
    const rejection = mediaRejection(candidate, markup, document, assets)
    if (rejection) return rejected(rejection)
    document = candidate
    revision++
    revisions.set(revision, globalThis.structuredClone(document))
    writes.push('publish')
    const response = { document, revision, fingerprint: fingerprint(), requestId: body.requestId }
    publications.set(body.requestId, { request: md5(candidate), response })
    return { value: response }
  }
  const replace = (asset) => {
    assets = assets.map((item) => (item.id === asset.id ? asset : item))
    return asset
  }
  const assetMetadata = (body) => {
    const allowed = new Set(['operation', 'id', 'version', 'name', 'alt', 'archived'])
    if (Object.keys(body).some((key) => !allowed.has(key)))
      return rejected('request: Unsupported field')
    const asset = assets.find((item) => item.id === body.id)
    if (!asset || asset.version !== body.version) return { status: 409, value: CONFLICT }
    return {
      value: replace({
        ...asset,
        name: body.name.trim(),
        alt: body.alt,
        archived: body.archived,
        version: asset.version + 1,
      }),
    }
  }
  const assetLifecycle = (body) => {
    const asset = assets.find((item) => item.id === body.id)
    if (!asset || asset.version !== body.version) return { status: 409, value: CONFLICT }
    const references = usage(asset)
    if (
      (body.action === 'trash' && references.currentReferences > 0) ||
      (body.action === 'delete' &&
        (!asset.trashed_at || references.currentReferences > 0 || references.historyReferences > 0))
    )
      return { status: 422, value: RULE_REJECTED }
    if (body.action === 'delete') {
      assets = assets.filter((item) => item.id !== asset.id)
      objects.delete(mediaKey(asset))
      return { value: { deleted: true, id: asset.id, usage: references } }
    }
    const next = {
      ...asset,
      archived: body.action !== 'restore',
      trashed_at: body.action === 'trash' ? (asset.trashed_at ?? new Date().toISOString()) : null,
      version: asset.version + 1,
    }
    return { value: { asset: replace(next), usage: references } }
  }
  const studio = async (body) => {
    requests.push(body)
    await hold(body.operation)
    if (body.operation === 'state')
      return { value: { revision, fingerprint: fingerprint(), assets, document } }
    if (body.operation === 'history')
      return {
        value: [...revisions.keys()].reverse().map((value) => ({
          revision: value,
          created_at: '2026-09-21T12:00:00Z',
          summary: 'Publicerat sidinnehåll',
        })),
      }
    if (body.operation === 'revision') return { value: { document: revisions.get(body.revision) } }
    if (body.operation === 'asset_usage') {
      const asset = assets.find((item) => item.id === body.id)
      return { value: asset ? usage(asset) : { currentReferences: 0, historyReferences: 0 } }
    }
    if (body.operation === 'asset') return assetMetadata(body)
    if (body.operation === 'asset_lifecycle') return assetLifecycle(body)
    if (['validate', 'publish'].includes(body.operation)) {
      let checked
      try {
        checked = validated(body)
      } catch (error) {
        if (!(error instanceof CmsValidationError)) throw error
        console.error('CMS_VALIDATION_ERROR', error.message)
        return rejected(error.message)
      }
      if (body.operation === 'publish') return publish(body, checked)
      const rejection = mediaRejection(checked.candidate, checked.markup, document, assets)
      return rejection ? rejected(rejection) : { value: { document: checked.candidate } }
    }
    throw new Error(`Unexpected CMS request: ${body.operation}`)
  }
  const upload = async (request) => {
    requests.push({ operation: 'upload' })
    await hold('upload')
    const form = await new globalThis.Response(request.postDataBuffer(), {
      headers: { 'content-type': request.headers()['content-type'] },
    }).formData()
    const asset = uploadedAsset(form)
    objects.add(mediaKey(asset))
    assets = [asset, ...assets]
    return { value: { ok: true, asset } }
  }
  await context.route('**/api/cms/presentation', (route) =>
    route.fulfill({
      json: { revision, presentation: document.presentation },
    }),
  )
  await routeApi(context, [
    [
      `${STORAGE_ORIGIN}/**`,
      async (route, headers) => {
        const request = route.request()
        const path = new URL(request.url()).pathname

        const reply = ({ status = 200, value }) => route.fulfill({ status, headers, json: value })

        if (path === '/functions/v1/cms-studio') return reply(await studio(request.postDataJSON()))
        if (path === '/functions/v1/upload-image') return reply(await upload(request))
        if (path.startsWith('/storage/v1/object/public/'))
          return route.fulfill({ status: 404, headers, body: '' })
        if (path === '/rest/v1/rpc/public_business_discovery')
          return reply({
            value: { settings: document.settings, barbers: [], services: [], schedules: [] },
          })
        if (path === '/rest/v1/rpc/public_booking_catalog')
          return reply({ value: { barbers: [], services: [] } })
        if (path === '/rest/v1/site_content') {
          const lang = new URL(request.url()).searchParams.get('lang')?.slice(3) ?? 'sv'
          return reply({ value: [{ key: 'kicker', lang, value: `KNC source ${lang}` }] })
        }
        if (path.startsWith('/rest/v1/')) return reply({ value: [] })
        writes.push(path)
        return reply({ status: 403, value: { error: 'not_available_in_preview' } })
      },
    ],
  ])
  return {
    writes,
    requests,
    get assets() {
      return assets
    },
    get document() {
      return document
    },
  }
}
