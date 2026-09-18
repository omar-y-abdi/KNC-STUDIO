import { retainCmsObject } from '../_shared/cmsRetention.ts'
import { handleCmsUpload, CmsMediaUnavailable } from './cmsUpload.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  Gravity,
  ImageMagick,
  MagickFormat,
  MagickGeometry,
  initializeImageMagick,
} from 'npm:@imagemagick/magick-wasm@0.0.42'
import {
  executeExternalAction,
  ExternalActionError,
  parseExternalAction,
  type ExternalActionService,
} from '../_shared/externalActions.ts'

const MAX_INPUT_BYTES = 5 * 1024 * 1024
const MAX_OUTPUT_BYTES = 512000
const MAX_PIXELS = 25_000_000
const GALLERY_LONG_SIDE = 1600
const PROFILE_SIZE = 800
const INITIAL_WEBP_QUALITY = 82
const MIN_WEBP_QUALITY = 55
const WEBP_QUALITY_STEP = 3
const BARBER_ID = /^[a-z0-9-]{1,32}$/
const SUPPORTED_FORMATS = new Set(['JPEG', 'PNG', 'WEBP', 'AVIF', 'HEIC', 'HEIF'])

type ProcessedImage = {
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

let imageMagickReady: Promise<void> | null = null

function ensureImageMagickReady(): Promise<void> {
  imageMagickReady ??= Deno.readFile(new URL('./magick.wasm', import.meta.url)).then((wasm) =>
    initializeImageMagick(wasm),
  )
  return imageMagickReady
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type UploadRequest =
  | {
      readonly kind: 'gallery'
      readonly file: File
      readonly galleryKind: 'salon' | 'cuts'
      readonly alt: string
      readonly sortOrder: number
    }
  | {
      readonly kind: 'barber_photo'
      readonly file: File
      readonly barberId: string
    }
  | {
      readonly kind: 'site_logo'
      readonly file: File
      readonly expectedPath: string
    }

type DeleteRequest =
  | {
      readonly action: 'delete'
      readonly kind: 'gallery'
      readonly id: string
      readonly storagePath: string
    }
  | {
      readonly action: 'delete'
      readonly kind: 'barber_photo'
      readonly barberId: string
      readonly storagePath: string
    }
  | {
      readonly action: 'delete'
      readonly kind: 'site_logo'
      readonly storagePath: string
    }

const LOGO_PATH =
  /^logo\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/

class ImageValidationError extends Error {
  readonly code: 'unsupported_image' | 'image_too_large' | 'output_too_large'

  constructor(code: 'unsupported_image' | 'image_too_large' | 'output_too_large') {
    super(code)
    this.code = code
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function textField(form: FormData, name: string): string | null {
  const values = form.getAll(name)
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null
}

function fileField(form: FormData): File | null {
  const values = form.getAll('file')
  return values.length === 1 && values[0] instanceof File ? values[0] : null
}

function hasOnlyFields(form: FormData, allowed: readonly string[]): boolean {
  const allowedFields = new Set(allowed)
  for (const [name] of form.entries()) {
    if (!allowedFields.has(name)) return false
  }
  return true
}

function parseInteger(value: string): number | null {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < -2147483648 || parsed > 2147483647) return null
  return parsed
}

function parseUpload(form: FormData): UploadRequest | null {
  const kind = textField(form, 'kind')
  const file = fileField(form)
  if (kind === null || file === null || file.size === 0) return null

  if (kind === 'gallery') {
    if (!hasOnlyFields(form, ['kind', 'file', 'galleryKind', 'alt', 'sortOrder'])) return null
    const galleryKind = textField(form, 'galleryKind')
    const alt = textField(form, 'alt')
    const sortOrder = textField(form, 'sortOrder')
    const parsedSortOrder = sortOrder === null ? null : parseInteger(sortOrder)

    if (
      (galleryKind !== 'salon' && galleryKind !== 'cuts') ||
      alt === null ||
      alt.length > 2000 ||
      parsedSortOrder === null
    ) {
      return null
    }

    return {
      kind,
      file,
      galleryKind,
      alt: alt.trim(),
      sortOrder: parsedSortOrder,
    }
  }

  if (kind === 'barber_photo') {
    if (!hasOnlyFields(form, ['kind', 'file', 'barberId'])) return null
    const barberId = textField(form, 'barberId')
    if (barberId === null || !BARBER_ID.test(barberId)) return null
    return { kind, file, barberId }
  }

  if (kind === 'site_logo') {
    if (!hasOnlyFields(form, ['kind', 'file', 'expectedPath'])) return null
    const expectedPath = textField(form, 'expectedPath')
    if (expectedPath === null || (expectedPath !== '' && !LOGO_PATH.test(expectedPath))) return null
    return { kind, file, expectedPath }
  }

  return null
}

function parseDelete(value: unknown): DeleteRequest | null {
  if (typeof value !== 'object' || value === null) return null

  const body = value as Record<string, unknown>

  if (body.action !== 'delete' || typeof body.storagePath !== 'string') return null
  if (body.storagePath.length < 1 || body.storagePath.length > 300) return null

  if (
    body.kind === 'gallery' &&
    typeof body.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)
  ) {
    return {
      action: body.action,
      kind: body.kind,
      id: body.id,
      storagePath: body.storagePath,
    }
  }

  if (body.kind === 'site_logo' && LOGO_PATH.test(body.storagePath)) {
    return {
      action: body.action,
      kind: body.kind,
      storagePath: body.storagePath,
    }
  }

  if (
    body.kind === 'barber_photo' &&
    typeof body.barberId === 'string' &&
    BARBER_ID.test(body.barberId) &&
    body.storagePath.startsWith(`${body.barberId}/`)
  ) {
    return {
      action: body.action,
      kind: body.kind,
      barberId: body.barberId,
      storagePath: body.storagePath,
    }
  }

  return null
}

function imageDimensions(image: { readonly width: number; readonly height: number }): {
  readonly width: number
  readonly height: number
} {
  const width = image.width
  const height = image.height

  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new ImageValidationError('unsupported_image')
  }

  if (width * height > MAX_PIXELS) {
    throw new ImageValidationError('image_too_large')
  }

  return { width, height }
}

function encodeWebp(image: {
  quality: number
  write(format: MagickFormat, callback: (data: Uint8Array) => void): void
}): Uint8Array {
  for (
    let quality = INITIAL_WEBP_QUALITY;
    quality >= MIN_WEBP_QUALITY;
    quality -= WEBP_QUALITY_STEP
  ) {
    image.quality = quality

    const encoded: { value?: Uint8Array } = {}

    image.write(MagickFormat.WebP, (data) => {
      encoded.value = new Uint8Array(data)
    })

    if (encoded.value !== undefined && encoded.value.byteLength <= MAX_OUTPUT_BYTES) {
      return encoded.value
    }
  }

  throw new ImageValidationError('output_too_large')
}

function processImage(input: Uint8Array, kind: UploadRequest['kind']): ProcessedImage {
  let output: ProcessedImage | null = null

  ImageMagick.read(input, (image) => {
    const optionalOperations = image as unknown as {
      autoOrient?: () => void
      strip?: () => void
    }

    optionalOperations.autoOrient?.()

    if (!SUPPORTED_FORMATS.has(String(image.format).toUpperCase())) {
      throw new ImageValidationError('unsupported_image')
    }

    const { width, height } = imageDimensions(image)

    if (kind === 'gallery' || kind === 'site_logo') {
      const longSide = Math.max(width, height)

      if (longSide > GALLERY_LONG_SIDE) {
        const scale = GALLERY_LONG_SIDE / longSide

        image.resize(
          new MagickGeometry(
            Math.max(1, Math.round(width * scale)),
            Math.max(1, Math.round(height * scale)),
          ),
        )
      }
    } else {
      const scale = Math.max(PROFILE_SIZE / width, PROFILE_SIZE / height)

      image.resize(
        new MagickGeometry(
          Math.max(PROFILE_SIZE, Math.round(width * scale)),
          Math.max(PROFILE_SIZE, Math.round(height * scale)),
        ),
      )

      image.crop(new MagickGeometry(PROFILE_SIZE, PROFILE_SIZE), Gravity.Center)
    }

    optionalOperations.strip?.()

    const processedWidth = image.width
    const processedHeight = image.height
    const bytes = encodeWebp(image)

    output = {
      bytes,
      width: processedWidth,
      height: processedHeight,
    }
  })

  if (output === null) {
    throw new ImageValidationError('unsupported_image')
  }

  return output
}

function isGalleryRow(value: unknown): value is {
  readonly id: string
  readonly kind: 'salon' | 'cuts'
  readonly storage_path: string
  readonly alt: string
  readonly sort_order: number
} {
  if (typeof value !== 'object' || value === null) return false

  const row = value as Record<string, unknown>

  return (
    typeof row.id === 'string' &&
    (row.kind === 'salon' || row.kind === 'cuts') &&
    typeof row.storage_path === 'string' &&
    typeof row.alt === 'string' &&
    typeof row.sort_order === 'number' &&
    Number.isInteger(row.sort_order)
  )
}

function isDeletion(value: unknown): value is {
  readonly ok: true
  readonly bucket: 'gallery' | 'barber-photos'
  readonly path: string
  readonly deletion_id: string
} {
  if (typeof value !== 'object' || value === null) return false

  const row = value as Record<string, unknown>

  return (
    row.ok === true &&
    (row.bucket === 'gallery' || row.bucket === 'barber-photos') &&
    typeof row.path === 'string' &&
    typeof row.deletion_id === 'string'
  )
}

function isReplacement(value: unknown): value is {
  readonly ok: true
  readonly previous_path: string | null
  readonly deletion_id: string | null
} {
  if (typeof value !== 'object' || value === null) return false

  const row = value as Record<string, unknown>

  return (
    row.ok === true &&
    (row.previous_path === null || typeof row.previous_path === 'string') &&
    (row.deletion_id === null || typeof row.deletion_id === 'string')
  )
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const publicSupabaseUrl = Deno.env.get('PUBLIC_SUPABASE_URL') ?? supabaseUrl
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !publicSupabaseUrl || !anonKey || !serviceKey) {
    console.error('upload-image: missing Supabase runtime configuration')
    return json({ ok: false, error: 'not_configured' }, 500)
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const removeObject = async (
    bucket: 'gallery' | 'barber-photos',
    path: string,
    deletionId: string | null = null,
  ): Promise<boolean> => {
    if (deletionId !== null) {
      const claimed = await service.rpc('claim_external_action', {
        p_id: deletionId,
      })

      if (claimed.error !== null || claimed.data === null) {
        console.error('upload-image: failed to claim external deletion action', claimed.error?.code)
        return false
      }

      const action = parseExternalAction(claimed.data)

      if (
        action === null ||
        action.action_type !== 'storage_object_delete' ||
        action.bucket !== bucket ||
        action.path !== path
      ) {
        console.error('upload-image: invalid external deletion action context')
        return false
      }

      try {
        await executeExternalAction(action, service as unknown as ExternalActionService, {
          googleClientId: undefined,
          googleClientSecret: undefined,
        })
      } catch (externalError) {
        const code =
          externalError instanceof ExternalActionError
            ? externalError.code
            : 'external_action_failed'

        console.error(
          `upload-image: failed to remove ${bucket} object`,
          externalError instanceof Error ? externalError.message : 'unknown',
        )

        await service.rpc('fail_external_action', {
          p_id: action.id,
          p_dispatch_token: action.dispatch_token,
          p_error_code: code,
        })

        return false
      }

      const completed = await service.rpc('complete_external_action', {
        p_id: action.id,
        p_dispatch_token: action.dispatch_token,
      })

      if (completed.error !== null || completed.data !== true) {
        console.error('upload-image: failed to complete external deletion action')
        return false
      }

      return true
    }

    try {
      if (await retainCmsObject(service, bucket, path)) {
        return true
      }
    } catch {
      return false
    }

    const { error } = await service.storage.from(bucket).remove([path])

    if (error !== null) {
      console.error(`upload-image: failed to remove ${bucket} object`, error.message)

      await service.rpc('internal_queue_storage_deletion', {
        p_bucket: bucket,
        p_object_path: path,
      })

      return false
    }

    return true
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (jwt === '') {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const caller = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  })

  const { data: callerData, error: callerError } = await service.auth.getUser(jwt)

  if (callerError !== null || callerData.user === null) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const { data: profile, error: profileError } = await caller
    .from('profiles')
    .select('role, barber_id, account_enabled')
    .eq('id', callerData.user.id)
    .single()

  if (profileError !== null || profile === null) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  if (profile.account_enabled !== true || (profile.role !== 'owner' && profile.role !== 'barber')) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.startsWith('application/json')) {
    let rawDelete: unknown

    try {
      rawDelete = await req.json()
    } catch {
      return json({ ok: false, error: 'invalid_payload' }, 400)
    }

    const deletion = parseDelete(rawDelete)

    if (deletion === null) {
      return json({ ok: false, error: 'invalid_payload' }, 400)
    }

    if (
      (deletion.kind === 'gallery' || deletion.kind === 'site_logo') &&
      profile.role !== 'owner'
    ) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }

    if (
      deletion.kind === 'barber_photo' &&
      profile.role !== 'owner' &&
      profile.barber_id !== deletion.barberId
    ) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }

    const queued =
      deletion.kind === 'gallery'
        ? await service.rpc('internal_delete_gallery_image', {
            p_id: deletion.id,
            p_expected_path: deletion.storagePath,
          })
        : deletion.kind === 'barber_photo'
          ? await service.rpc('internal_delete_barber_photo', {
              p_barber_id: deletion.barberId,
              p_expected_path: deletion.storagePath,
            })
          : await service.rpc('internal_remove_homepage_logo', {
              p_expected_path: deletion.storagePath,
            })

    if (queued.error !== null) {
      console.error('upload-image: deletion transaction failed', queued.error.code)
      return json({ ok: false, error: 'database_failed' }, 500)
    }

    if (!isDeletion(queued.data)) {
      return json({ ok: false, error: 'not_found' }, 404)
    }

    const removed = await removeObject(
      queued.data.bucket,
      queued.data.path,
      queued.data.deletion_id,
    )

    return json(
      {
        ok: true,
        pending: !removed,
      },
      removed ? 200 : 202,
    )
  }

  if (!contentType.startsWith('multipart/form-data')) {
    return json({ ok: false, error: 'invalid_multipart' }, 400)
  }

  let form: FormData

  try {
    form = await req.formData()
  } catch {
    return json({ ok: false, error: 'invalid_multipart' }, 400)
  }

  if (form.get('kind') === 'cms_asset') {
    return handleCmsUpload(
      form,
      callerData.user.id,
      service,
      async (input, profileImage) => {
        try {
          await ensureImageMagickReady()
        } catch {
          throw new CmsMediaUnavailable('Image decoder unavailable')
        }

        return processImage(input, profileImage ? 'barber_photo' : 'gallery')
      },
      json,
    )
  }

  const upload = parseUpload(form)

  if (upload === null) {
    return json({ ok: false, error: 'invalid_payload' }, 400)
  }

  if (upload.file.size > MAX_INPUT_BYTES) {
    return json({ ok: false, error: 'file_too_large' }, 413)
  }

  if ((upload.kind === 'gallery' || upload.kind === 'site_logo') && profile.role !== 'owner') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  if (
    upload.kind === 'barber_photo' &&
    profile.role !== 'owner' &&
    (profile.barber_id !== upload.barberId || typeof profile.barber_id !== 'string')
  ) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  let processed: Uint8Array

  try {
    await ensureImageMagickReady()
  } catch (error) {
    console.error('upload-image: ImageMagick initialization failed', error)
    return json({ ok: false, error: 'image_processor_unavailable' }, 500)
  }

  try {
    processed = processImage(new Uint8Array(await upload.file.arrayBuffer()), upload.kind).bytes
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return json({ ok: false, error: error.code }, 422)
    }

    console.warn('upload-image: image decode failed', error)
    return json({ ok: false, error: 'invalid_image' }, 422)
  }

  const bucket = upload.kind === 'barber_photo' ? 'barber-photos' : 'gallery'

  const path =
    upload.kind === 'gallery'
      ? `${upload.galleryKind}/${crypto.randomUUID()}.webp`
      : upload.kind === 'barber_photo'
        ? `${upload.barberId}/${crypto.randomUUID()}.webp`
        : `logo/${crypto.randomUUID()}.webp`

  let previousPath: string | null = null

  if (upload.kind === 'barber_photo') {
    const previous = await caller
      .from('barber_photos')
      .select('storage_path')
      .eq('barber_id', upload.barberId)
      .maybeSingle()

    if (
      previous.error !== null ||
      (previous.data !== null && typeof previous.data.storage_path !== 'string')
    ) {
      console.error('upload-image: could not read existing barber photo', previous.error?.message)

      return json({ ok: false, error: 'database_failed' }, 500)
    }

    previousPath = previous.data?.storage_path ?? null
  }

  const stored = await service.storage.from(bucket).upload(path, processed, {
    contentType: 'image/webp',
    upsert: false,
  })

  if (stored.error !== null) {
    console.error('upload-image: object upload failed', stored.error.message)
    return json({ ok: false, error: 'storage_failed' }, 500)
  }

  if (upload.kind === 'gallery') {
    const inserted = await service.rpc('internal_insert_gallery_image', {
      p_kind: upload.galleryKind,
      p_storage_path: path,
      p_alt: upload.alt,
      p_sort_order: upload.sortOrder,
    })

    if (inserted.error !== null || !isGalleryRow(inserted.data)) {
      console.error('upload-image: gallery row insert failed', inserted.error?.message)

      await removeObject(bucket, path)

      return json({ ok: false, error: 'database_failed' }, 500)
    }

    const publicUrl = createClient(publicSupabaseUrl, anonKey)
      .storage.from(bucket)
      .getPublicUrl(inserted.data.storage_path).data.publicUrl

    return json(
      {
        ok: true,
        kind: 'gallery',
        row: inserted.data,
        path: inserted.data.storage_path,
        publicUrl,
      },
      200,
    )
  }

  if (upload.kind === 'site_logo') {
    const replaced = await service.rpc('internal_replace_homepage_logo', {
      p_expected_path: upload.expectedPath,
      p_new_path: path,
    })

    if (replaced.error !== null || !isReplacement(replaced.data)) {
      console.error('upload-image: homepage logo replace failed', replaced.error?.code)

      await removeObject(bucket, path)

      const response =
        typeof replaced.data === 'object' &&
        replaced.data !== null &&
        (replaced.data as Record<string, unknown>).error === 'conflict'
          ? { status: 409, error: 'conflict' }
          : { status: 500, error: 'database_failed' }

      return json(
        {
          ok: false,
          error: response.error,
        },
        response.status,
      )
    }

    let cleanupPending = false

    if (replaced.data.previous_path !== null && replaced.data.deletion_id !== null) {
      cleanupPending = !(await removeObject(
        bucket,
        replaced.data.previous_path,
        replaced.data.deletion_id,
      ))
    }

    const publicUrl = createClient(publicSupabaseUrl, anonKey)
      .storage.from(bucket)
      .getPublicUrl(path).data.publicUrl

    return json(
      {
        ok: true,
        kind: 'site_logo',
        path,
        publicUrl,
        cleanupPending,
      },
      200,
    )
  }

  const replaced = await service.rpc('internal_replace_barber_photo', {
    p_barber_id: upload.barberId,
    p_expected_path: previousPath,
    p_new_path: path,
  })

  if (replaced.error !== null || !isReplacement(replaced.data)) {
    console.error('upload-image: barber photo replace failed', replaced.error?.code)

    await removeObject(bucket, path)

    const response =
      typeof replaced.data === 'object' &&
      replaced.data !== null &&
      (replaced.data as Record<string, unknown>).error === 'conflict'
        ? { status: 409, error: 'conflict' }
        : { status: 500, error: 'database_failed' }

    return json(
      {
        ok: false,
        error: response.error,
      },
      response.status,
    )
  }

  let cleanupPending = false

  if (replaced.data.previous_path !== null && replaced.data.deletion_id !== null) {
    cleanupPending = !(await removeObject(
      bucket,
      replaced.data.previous_path,
      replaced.data.deletion_id,
    ))
  }

  const publicUrl = createClient(publicSupabaseUrl, anonKey).storage.from(bucket).getPublicUrl(path)
    .data.publicUrl

  return json(
    {
      ok: true,
      kind: 'barber_photo',
      row: {
        barber_id: upload.barberId,
        storage_path: path,
      },
      path,
      publicUrl,
      cleanupPending,
    },
    200,
  )
})
