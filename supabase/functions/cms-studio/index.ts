import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  CmsValidationError,
  validateCompleteDocument,
  validateDocumentMedia,
  documentMedia,
  documentMediaPlacements,
  mediaKey,
  type CmsDocument,
  type CmsState,
} from '../../../shared/cms.ts'
import {
  validateDocumentMarkupPlacements,
} from '../../../shared/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../../shared/cms-built-assets.ts'

const MAX_BODY = 2 * 1024 * 1024 + 4096
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new CmsValidationError('request', 'JSON is required')

  const reader = request.body?.getReader()
  if (!reader) throw new CmsValidationError('request', 'Body is required')

  const chunks: Uint8Array[] = []
  let size = 0

  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break

      size += part.value.byteLength

      if (size > MAX_BODY) {
        await reader.cancel()
        throw new CmsValidationError('request', 'Request exceeds 2 MiB')
      }

      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let position = 0

  for (const chunk of chunks) {
    bytes.set(chunk, position)
    position += chunk.length
  }

  let value: unknown

  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new CmsValidationError('request', 'Invalid JSON')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CmsValidationError('request', 'Expected an object')

  return value as Record<string, unknown>
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID()
  const origin = request.headers.get('origin')
  const allowedOrigins = [
    'https://bladeblendstudio.se',
    'https://www.bladeblendstudio.se',
    ...(Deno.env.get('CMS_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ]
  const allowedOrigin =
    origin === null ||
    allowedOrigins.includes(origin) ||
    /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
    vary: 'Origin',
  }
  if (origin && allowedOrigin) headers['access-control-allow-origin'] = origin
  const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), { status, headers })
  if (!allowedOrigin) return json({ error: 'forbidden_origin', requestId }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed', requestId }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL'),
    serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publicStorage = Deno.env.get('PUBLIC_SUPABASE_URL') ?? supabaseUrl
  if (!supabaseUrl || !serviceKey || !publicStorage)
    return json({ error: 'not_configured', requestId }, 503)
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if (!token || token.length > 16384) return json({ error: 'unauthorized', requestId }, 401)
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const identity = await service.auth.getUser(token)
    if (identity.error || !identity.data.user)
      return json({ error: 'unauthorized', requestId }, 401)
    const actor = identity.data.user.id
    // The database checks the current role, account status and forced-password gate.
    // No extra table/column privileges are needed by the service credential.
    const authorization = await service.rpc('internal_cms_assert_owner', { p_actor: actor })
    if (authorization.error) throw authorization.error
    const body = await readBody(request)
    const invoke = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const result = await service.rpc(name, { p_actor: actor, ...args })
      if (result.error) throw result.error
      return result.data
    }
    const only = (...names: string[]): void => {
      if (Object.keys(body).some((key) => !['operation', ...names].includes(key)))
        throw new CmsValidationError('request', 'Unsupported field')
    }
    const readInteger = (key: string, fallback?: number): number => {
      const value = body[key] ?? fallback
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new CmsValidationError(key, 'Expected a positive integer')
      return value
    }
    if (body.operation === 'state') {
      only()
      return json(await invoke('internal_cms_state', {}))
    }
    if (body.operation === 'history') {
      only('before')
      return json(
        await invoke('internal_cms_history', {
          p_before: readInteger('before', Number.MAX_SAFE_INTEGER),
        }),
      )
    }
    if (body.operation === 'revision') {
      only('revision')
      const result = await invoke('internal_cms_revision', { p_revision: readInteger('revision') })
      return result ? json(result) : json({ error: 'not_found', requestId }, 404)
    }
    if (body.operation === 'asset') {
      only('id', 'version', 'name', 'alt', 'archived')
      if (
        typeof body.id !== 'string' ||
        !UUID.test(body.id) ||
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 160 ||
        typeof body.alt !== 'string' ||
        body.alt.length > 2000 ||
        typeof body.archived !== 'boolean'
      )
        throw new CmsValidationError('asset', 'Invalid asset metadata')
      return json(
        await invoke('internal_cms_asset_update', {
          p_id: body.id,
          p_version: readInteger('version'),
          p_name: body.name.trim(),
          p_alt: body.alt,
          p_archived: body.archived,
        }),
      )
    }
    if (body.operation !== 'validate' && body.operation !== 'publish')
      throw new CmsValidationError('operation', 'Unknown operation')
    only(
      'document',
      ...(body.operation === 'publish' ? ['baseRevision', 'baseFingerprint', 'requestId'] : []),
    )
    const validationState = (await invoke('internal_cms_state', {})) as CmsState
    const authoritative = validationState.document
    validateCompleteDocument(body.document, authoritative)
    const document: CmsDocument = structuredClone(body.document)
    const policy = {
      siteOrigin: origin ?? 'https://bladeblendstudio.se',
      storageOrigin: new URL(publicStorage).origin,
      builtAssets: CMS_BUILT_ASSETS,
    }
    const authoritativeDocument: CmsDocument = structuredClone(authoritative)
    const authoritativeMarkup = validateDocumentMarkupPlacements(authoritativeDocument, policy)
    const currentPlacements = [
      ...documentMediaPlacements(authoritativeDocument),
      ...authoritativeMarkup,
    ]
    const authoredMarkup = validateDocumentMarkupPlacements(document, policy)
    validateDocumentMedia(document, validationState.assets, authoredMarkup, currentPlacements)
    const references = [...documentMedia(document), ...authoredMarkup.map(({ ref }) => ref)]
    const referenceKeys = [...new Set(references.map(mediaKey))]
    const inventory = await service.rpc('internal_cms_missing_media', {
      p_actor: actor,
      p_references: referenceKeys.map((key) => ({
        bucket: key.slice(0, key.indexOf('/')),
        path: key.slice(key.indexOf('/') + 1),
      })),
    })
    if (inventory.error) throw inventory.error
    if (!Array.isArray(inventory.data)) throw new Error('Invalid media validation result')
    if (inventory.data.length)
      throw new CmsValidationError(
        'media',
        'En refererad fil saknas eller är inte registrerad. Välj filen på nytt i biblioteket.',
      )
    validateCompleteDocument(document, authoritative)
    if (body.operation === 'validate') return json({ document })
    if (
      typeof body.baseFingerprint !== 'string' ||
      !/^[0-9a-f]{32}$/.test(body.baseFingerprint) ||
      typeof body.requestId !== 'string' ||
      !UUID.test(body.requestId)
    )
      throw new CmsValidationError('publication', 'Invalid publication identity')
    const result = await invoke('internal_cms_publish', {
      p_document: document,
      p_base_revision: readInteger('baseRevision'),
      p_base_fingerprint: body.baseFingerprint,
      p_request_id: body.requestId,
    })
    return json(result)
  } catch (error) {
    if (error instanceof CmsValidationError)
      return json({ error: 'invalid_content', message: error.message, requestId }, 422)
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === '40001')
      return json(
        {
          error: 'conflict',
          message: 'Innehållet har ändrats. Jämför med den senaste versionen innan du publicerar.',
          requestId,
        },
        409,
      )
    if (code === '42501') return json({ error: 'forbidden', requestId }, 403)
    if (['22023', '23514', '23502', '23503', '23505'].includes(code))
      return json(
        {
          error: 'invalid_content',
          message: 'Innehållet uppfyller inte databasens innehållsregler.',
          requestId,
        },
        422,
      )
    console.error(
      JSON.stringify({
        event: 'cms_studio_failure',
        requestId,
        code: /^[A-Z0-9]{5}$/.test(code) ? code : 'unexpected',
      }),
    )
    return json(
      {
        error: 'unavailable',
        message: `Tillfälligt fel. Ditt utkast är kvar. Fel-ID: ${requestId}`,
        requestId,
      },
      503,
    )
  }
})
