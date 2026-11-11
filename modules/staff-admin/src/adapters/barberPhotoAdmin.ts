import type { z } from 'zod'
import { getAdminClient } from '../adminClient'
import {
  barberPhotoRowT,
  imageDeleteResponse,
  parseWith,
  uploadBarberPhotoResponse,
  uploadBarberWorkResponse,
  workDeleteResponse,
} from '../adminSchemas'
import type { AdminBarberId, AdminResult } from '../types'
import { err, ok } from '../types'
import { mediaGatewayError } from './mediaGateway'

const BUCKET = 'barber-photos'
const WORK_BUCKET = 'barber-work'
const READ_ERROR = 'Kunde inte läsa profilbilden.'
const WRITE_ERROR = 'Kunde inte ladda upp bilden. Försök igen.'
const DELETE_ERROR = 'Kunde inte ta bort bilden. Försök igen.'
const FORBIDDEN = 'Du har inte behörighet för detta.'
const VALIDATION_ERROR = 'Bilden uppfyller inte kraven.'
const DELETE_VALIDATION_ERROR = 'Bilden kunde inte tas bort. Ladda om sidan.'

type UploadKind = 'barber_photo' | 'barber_work'
type GatewayMessages = Parameters<typeof mediaGatewayError>[1]

function publicUrl(bucket: string, storagePath: string): string {
  return getAdminClient().storage.from(bucket).getPublicUrl(storagePath).data.publicUrl
}

/** The public URL of a work picture, built like the profile photo's. */
export function barberWorkUrl(storagePath: string): string {
  return publicUrl(WORK_BUCKET, storagePath)
}

function uploadForm(kind: UploadKind, barberId: AdminBarberId, file: File): FormData {
  const form = new FormData()
  form.set('kind', kind)
  form.set('file', file)
  form.set('barberId', barberId)
  return form
}

/** One `upload-image` call: a refused answer through `mediaGatewayError`, a 2xx answer parsed. */
async function invokeUploadImage<T>(
  body: FormData | Readonly<Record<string, string>>,
  schema: z.ZodType<T>,
  messages: GatewayMessages,
): Promise<AdminResult<T>> {
  try {
    const { data, error } = await getAdminClient().functions.invoke('upload-image', { body })
    if (error !== null) return mediaGatewayError(error, messages)
    const parsed = parseWith(schema, data)
    if (!parsed.ok) return err('malformed', messages.fallback)
    return ok(parsed.value)
  } catch {
    return err('network', messages.fallback)
  }
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
    return ok({
      storagePath: parsed.value.storage_path,
      url: publicUrl(BUCKET, parsed.value.storage_path),
    })
  } catch {
    return err('network', READ_ERROR)
  }
}

export async function uploadBarberPhoto(
  barberId: AdminBarberId,
  file: File,
): Promise<AdminResult<{ storagePath: string; url: string }>> {
  const result = await invokeUploadImage(
    uploadForm('barber_photo', barberId, file),
    uploadBarberPhotoResponse,
    { fallback: WRITE_ERROR, forbidden: FORBIDDEN, validation: VALIDATION_ERROR },
  )
  return result.ok ? ok({ storagePath: result.value.path, url: result.value.publicUrl }) : result
}

export async function removeBarberPhoto(
  barberId: AdminBarberId,
  storagePath: string,
): Promise<AdminResult<{ readonly pending: boolean }>> {
  const result = await invokeUploadImage(
    { action: 'delete', kind: 'barber_photo', barberId, storagePath },
    imageDeleteResponse,
    { fallback: DELETE_ERROR, forbidden: FORBIDDEN, validation: DELETE_VALIDATION_ERROR },
  )
  return result.ok ? ok({ pending: result.value.pending }) : result
}

export async function uploadBarberWork(
  barberId: AdminBarberId,
  file: File,
): Promise<AdminResult<{ readonly id: string; readonly path: string }>> {
  const result = await invokeUploadImage(
    uploadForm('barber_work', barberId, file),
    uploadBarberWorkResponse,
    { fallback: WRITE_ERROR, forbidden: FORBIDDEN, validation: VALIDATION_ERROR },
  )
  return result.ok ? ok({ id: result.value.id, path: result.value.path }) : result
}

/** `storagePath` exactly as the profile read gave it: the gateway accepts only its own names. */
export async function removeBarberWork(
  barberId: AdminBarberId,
  storagePath: string,
): Promise<AdminResult<void>> {
  const result = await invokeUploadImage(
    { action: 'delete', kind: 'barber_work', barberId, storagePath },
    workDeleteResponse,
    { fallback: DELETE_ERROR, forbidden: FORBIDDEN, validation: DELETE_VALIDATION_ERROR },
  )
  return result.ok ? ok(undefined) : result
}
