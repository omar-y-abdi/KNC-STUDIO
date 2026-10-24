import { retainCmsObject } from '../_shared/cmsRetention.ts'
import { handleCmsUpload, CmsMediaUnavailable } from './cmsUpload.ts'
import { createClient } from '@supabase/supabase-js'
import { initializeImageMagick } from 'npm:@imagemagick/magick-wasm@0.0.42'
import { ImageValidationError, processImage } from './processImage.ts'
import {
  executeExternalAction,
  ExternalActionError,
  parseExternalAction,
  type ExternalActionService,
} from '../_shared/externalActions.ts'
import { corsHeaders, corsJson as json } from '../_shared/http.ts'
import { deleteSchema, formFields, uploadSchema } from './request.ts'

const MAX_INPUT_BYTES = 5 * 1024 * 1024
let imageMagickReady: Promise<void> | null = null

function ensureImageMagickReady(): Promise<void> {
  imageMagickReady ??= Deno.readFile(new URL('./magick.wasm', import.meta.url)).then((wasm) =>
    initializeImageMagick(wasm),
  )
  return imageMagickReady
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
    const request = deleteSchema.safeParse(await req.json().catch(() => null))

    if (!request.success) {
      return json({ ok: false, error: 'invalid_payload' }, 400)
    }

    const deletion = request.data

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

  const request = uploadSchema.safeParse(formFields(form))

  if (!request.success) {
    return json({ ok: false, error: 'invalid_payload' }, 400)
  }

  const upload = request.data

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
