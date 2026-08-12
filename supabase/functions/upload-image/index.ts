import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  Gravity,
  ImageMagick,
  MagickFormat,
  MagickGeometry,
  initializeImageMagick,
} from 'npm:@imagemagick/magick-wasm@0.0.42'

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
const imageMagickReady = Deno.readFile(new URL('./magick.wasm', import.meta.url)).then((wasm) =>
  initializeImageMagick(wasm),
)

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
    return { kind, file, galleryKind, alt: alt.trim(), sortOrder: parsedSortOrder }
  }

  if (kind === 'barber_photo') {
    if (!hasOnlyFields(form, ['kind', 'file', 'barberId'])) return null
    const barberId = textField(form, 'barberId')
    if (barberId === null || !BARBER_ID.test(barberId)) return null
    return { kind, file, barberId }
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
  if (width * height > MAX_PIXELS) throw new ImageValidationError('image_too_large')
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
      encoded.value = data
    })
    if (encoded.value !== undefined && encoded.value.byteLength <= MAX_OUTPUT_BYTES) {
      return encoded.value
    }
  }
  throw new ImageValidationError('output_too_large')
}

function processImage(input: Uint8Array, kind: UploadRequest['kind']): Uint8Array {
  let output: Uint8Array | null = null
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
    if (kind === 'gallery') {
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
    output = encodeWebp(image)
  })
  if (output === null) throw new ImageValidationError('unsupported_image')
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

function isBarberPhotoRow(
  value: unknown,
): value is { readonly barber_id: string; readonly storage_path: string } {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.barber_id === 'string' && typeof row.storage_path === 'string'
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('upload-image: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    return json({ ok: false, error: 'not_configured' }, 500)
  }
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const removeObject = async (bucket: 'gallery' | 'barber-photos', path: string): Promise<void> => {
    const { error } = await service.storage.from(bucket).remove([path])
    if (error !== null) {
      console.error(`upload-image: failed to remove ${bucket} object after rollback`, error.message)
    }
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (jwt === '') return json({ ok: false, error: 'unauthorized' }, 401)

  const { data: callerData, error: callerError } = await service.auth.getUser(jwt)
  if (callerError !== null || callerData.user === null)
    return json({ ok: false, error: 'unauthorized' }, 401)

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('role, barber_id')
    .eq('id', callerData.user.id)
    .single()
  if (profileError !== null || profile === null)
    return json({ ok: false, error: 'unauthorized' }, 401)
  if (profile.role !== 'owner' && profile.role !== 'barber') {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return json({ ok: false, error: 'invalid_multipart' }, 400)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ ok: false, error: 'invalid_multipart' }, 400)
  }
  const upload = parseUpload(form)
  if (upload === null) return json({ ok: false, error: 'invalid_payload' }, 400)
  if (upload.file.size > MAX_INPUT_BYTES) return json({ ok: false, error: 'file_too_large' }, 413)

  if (upload.kind === 'gallery' && profile.role !== 'owner') {
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
    await imageMagickReady
  } catch (error) {
    console.error('upload-image: ImageMagick initialization failed', error)
    return json({ ok: false, error: 'image_processor_unavailable' }, 500)
  }
  try {
    processed = processImage(new Uint8Array(await upload.file.arrayBuffer()), upload.kind)
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return json({ ok: false, error: error.code }, 422)
    }
    console.warn('upload-image: image decode failed', error)
    return json({ ok: false, error: 'invalid_image' }, 422)
  }

  const bucket = upload.kind === 'gallery' ? 'gallery' : 'barber-photos'
  const path =
    upload.kind === 'gallery'
      ? `${upload.galleryKind}/${crypto.randomUUID()}.webp`
      : `${upload.barberId}/${crypto.randomUUID()}.webp`

  let previousPath: string | null = null
  if (upload.kind === 'barber_photo') {
    const previous = await service
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
    const inserted = await service
      .from('gallery_images')
      .insert({
        kind: upload.galleryKind,
        storage_path: path,
        alt: upload.alt,
        sort_order: upload.sortOrder,
      })
      .select('id,kind,storage_path,alt,sort_order')
      .single()
    if (inserted.error !== null || !isGalleryRow(inserted.data)) {
      console.error('upload-image: gallery row insert failed', inserted.error?.message)
      await removeObject(bucket, path)
      return json({ ok: false, error: 'database_failed' }, 500)
    }
    const publicUrl = service.storage.from(bucket).getPublicUrl(inserted.data.storage_path)
      .data.publicUrl
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

  const upserted = await service
    .from('barber_photos')
    .upsert({ barber_id: upload.barberId, storage_path: path }, { onConflict: 'barber_id' })
    .select('barber_id,storage_path')
    .single()
  if (upserted.error !== null || !isBarberPhotoRow(upserted.data)) {
    console.error('upload-image: barber photo upsert failed', upserted.error?.message)
    await removeObject(bucket, path)
    return json({ ok: false, error: 'database_failed' }, 500)
  }

  if (previousPath !== null && previousPath !== upserted.data.storage_path) {
    await removeObject(bucket, previousPath)
  }
  const publicUrl = service.storage.from(bucket).getPublicUrl(upserted.data.storage_path)
    .data.publicUrl
  return json(
    {
      ok: true,
      kind: 'barber_photo',
      row: upserted.data,
      path: upserted.data.storage_path,
      publicUrl,
    },
    200,
  )
})
