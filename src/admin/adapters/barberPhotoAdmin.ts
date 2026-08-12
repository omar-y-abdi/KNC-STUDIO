import { getAdminClient } from '../adminClient'
import { barberPhotoRowT, parseWith, uploadBarberPhotoResponse } from '../adminSchemas'
import type { AdminBarberId, AdminResult } from '../types'
import { err, ok } from '../types'

const BUCKET = 'barber-photos'
const READ_ERROR = 'Kunde inte läsa profilbilden.'
const WRITE_ERROR = 'Kunde inte ladda upp bilden. Försök igen.'
const DELETE_ERROR = 'Kunde inte ta bort bilden. Försök igen.'
const FORBIDDEN = 'Du har inte behörighet för detta.'
const AUTH_ERROR = 'Din session har gått ut. Logga in igen.'
const VALIDATION_ERROR = 'Bilden uppfyller inte kraven.'

function publicUrl(storagePath: string): string {
  return getAdminClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
}

function uploadError<T>(error: unknown): AdminResult<T> {
  const status =
    typeof error === 'object' && error !== null && 'context' in error
      ? (error as { context?: { status?: unknown } }).context?.status
      : undefined
  if (status === 401) return err('auth', AUTH_ERROR)
  if (status === 403) return err('forbidden', FORBIDDEN)
  if (status === 400 || status === 413 || status === 422) return err('validation', VALIDATION_ERROR)
  return err('network', WRITE_ERROR)
}

export async function getBarberPhoto(
  barberId: AdminBarberId,
): Promise<AdminResult<{ storagePath: string; url: string } | null>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_photos')
      .select('barber_id,storage_path')
      .eq('barber_id', barberId)
      .maybeSingle()
    if (error !== null) return err('network', READ_ERROR)
    if (data === null) return ok(null)
    const parsed = parseWith(barberPhotoRowT, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok({ storagePath: parsed.value.storage_path, url: publicUrl(parsed.value.storage_path) })
  } catch {
    return err('network', READ_ERROR)
  }
}

export async function uploadBarberPhoto(
  barberId: AdminBarberId,
  file: File,
): Promise<AdminResult<{ storagePath: string; url: string }>> {
  const form = new FormData()
  form.set('kind', 'barber_photo')
  form.set('file', file)
  form.set('barberId', barberId)

  try {
    const { data, error } = await getAdminClient().functions.invoke('upload-image', { body: form })
    if (error !== null) return uploadError(error)

    const parsed = parseWith(uploadBarberPhotoResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok({ storagePath: parsed.value.path, url: parsed.value.publicUrl })
  } catch {
    return err('network', WRITE_ERROR)
  }
}

export async function removeBarberPhoto(
  barberId: AdminBarberId,
  storagePath: string,
): Promise<AdminResult<true>> {
  const supabase = getAdminClient()
  try {
    const { error } = await supabase.from('barber_photos').delete().eq('barber_id', barberId)
    if (error !== null) {
      if (error.code === '42501') return err('forbidden', FORBIDDEN)
      return err('network', DELETE_ERROR)
    }
    await supabase.storage.from(BUCKET).remove([storagePath])
    return ok(true)
  } catch {
    return err('network', DELETE_ERROR)
  }
}
