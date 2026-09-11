import { getAdminClient } from '../adminClient'
import {
  barberPhotoRowT,
  imageDeleteResponse,
  parseWith,
  uploadBarberPhotoResponse,
} from '../adminSchemas'
import type { AdminBarberId, AdminResult } from '../types'
import { err, ok } from '../types'
import { mediaGatewayError } from './mediaGateway'

const BUCKET = 'barber-photos'
const READ_ERROR = 'Kunde inte läsa profilbilden.'
const WRITE_ERROR = 'Kunde inte ladda upp bilden. Försök igen.'
const DELETE_ERROR = 'Kunde inte ta bort bilden. Försök igen.'
const FORBIDDEN = 'Du har inte behörighet för detta.'
const VALIDATION_ERROR = 'Bilden uppfyller inte kraven.'

function publicUrl(storagePath: string): string {
  return getAdminClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
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
    if (error !== null)
      return mediaGatewayError(error, {
        fallback: WRITE_ERROR,
        forbidden: FORBIDDEN,
        validation: VALIDATION_ERROR,
      })

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
): Promise<AdminResult<{ readonly pending: boolean }>> {
  try {
    const { data, error } = await getAdminClient().functions.invoke('upload-image', {
      body: { action: 'delete', kind: 'barber_photo', barberId, storagePath },
    })
    if (error !== null)
      return mediaGatewayError(error, {
        fallback: DELETE_ERROR,
        forbidden: FORBIDDEN,
        validation: 'Bilden kunde inte tas bort. Ladda om sidan.',
      })
    const parsed = parseWith(imageDeleteResponse, data)
    if (!parsed.ok) return err('malformed', DELETE_ERROR)
    return ok({ pending: parsed.value.pending })
  } catch {
    return err('network', DELETE_ERROR)
  }
}
