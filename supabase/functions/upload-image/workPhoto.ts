import type { SupabaseClient } from '@supabase/supabase-js'
import { json } from '../_shared/http.ts'

export const WORK_BUCKET = 'barber-work'

function isAdded(value: unknown): value is { readonly ok: true; readonly id: string } {
  if (typeof value !== 'object' || value === null) return false

  const row = value as Record<string, unknown>

  return row.ok === true && typeof row.id === 'string'
}

function isDeleted(value: unknown): value is { readonly ok: true } {
  return (
    typeof value === 'object' && value !== null && (value as Record<string, unknown>).ok === true
  )
}

export async function storeWorkPhoto(
  service: SupabaseClient,
  barberId: string,
  bytes: Uint8Array,
  publicUrl: (path: string) => string,
): Promise<Response> {
  const path = `${barberId}/${crypto.randomUUID()}.webp`
  const stored = await service.storage.from(WORK_BUCKET).upload(path, bytes, {
    contentType: 'image/webp',
    upsert: false,
    cacheControl: '31536000',
  })

  if (stored.error !== null) {
    console.error('upload-image: object upload failed', stored.error.message)
    return json({ ok: false, error: 'storage_failed' }, 500)
  }

  const added = await service.rpc('internal_add_barber_work_photo', {
    p_barber_id: barberId,
    p_path: path,
  })

  if (added.error !== null || !isAdded(added.data)) {
    console.error('upload-image: work picture insert failed', added.error?.code)

    const removed = await service.storage.from(WORK_BUCKET).remove([path])

    if (removed.error !== null) {
      console.error(`upload-image: failed to remove ${WORK_BUCKET} object`, removed.error.message)
    }

    return json({ ok: false, error: 'database_failed' }, 500)
  }

  return json(
    { ok: true, kind: 'barber_work', id: added.data.id, path, publicUrl: publicUrl(path) },
    200,
  )
}

/** Object first, row second: both steps are idempotent, so a retry completes a half-done delete. */
export async function deleteWorkPhoto(
  service: SupabaseClient,
  barberId: string,
  path: string,
): Promise<Response> {
  const removed = await service.storage.from(WORK_BUCKET).remove([path])

  if (removed.error !== null) {
    console.error(`upload-image: failed to remove ${WORK_BUCKET} object`, removed.error.message)
    return json({ ok: false, error: 'storage_failed' }, 500)
  }

  const deleted = await service.rpc('internal_delete_barber_work_photo', {
    p_barber_id: barberId,
    p_path: path,
  })

  if (deleted.error !== null || !isDeleted(deleted.data)) {
    console.error('upload-image: work picture delete failed', deleted.error?.code)
    return json({ ok: false, error: 'database_failed' }, 500)
  }

  return json({ ok: true }, 200)
}
