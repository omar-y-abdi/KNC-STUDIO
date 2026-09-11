// Homepage logo media adapter. Browser sends original bytes only to the authenticated Edge gateway;
// server processing, storage write, optimistic replacement, and durable old-byte cleanup stay server-side.

import { getAdminClient } from '../adminClient'
import { imageDeleteResponse, parseWith, uploadHomepageLogoResponse } from '../adminSchemas'
import type { AdminResult } from '../types'
import { err, ok } from '../types'
import { mediaGatewayError } from './mediaGateway'

const WRITE_ERROR = 'Kunde inte spara logotypen. Försök igen.'
const DELETE_ERROR = 'Kunde inte ta bort logotypen. Försök igen.'

function mapGatewayError<T>(error: unknown, fallback: string): AdminResult<T> {
  return mediaGatewayError(error, {
    fallback,
    forbidden: 'Endast ägaren kan ändra logotypen.',
    validation: 'Logotypen måste vara en giltig bild inom storleksgränsen.',
    conflict: 'Logotypen ändrades i en annan flik. Ladda om sidan.',
  })
}

export interface UploadedHomepageLogo {
  readonly path: string
  readonly url: string
  readonly cleanupPending: boolean
}

export function homepageLogoPublicUrl(path: string): string {
  return getAdminClient().storage.from('gallery').getPublicUrl(path).data.publicUrl
}

export async function uploadHomepageLogo(
  file: File,
  expectedPath: string,
): Promise<AdminResult<UploadedHomepageLogo>> {
  const form = new FormData()
  form.set('kind', 'site_logo')
  form.set('file', file)
  form.set('expectedPath', expectedPath)
  try {
    const { data, error } = await getAdminClient().functions.invoke('upload-image', { body: form })
    if (error !== null) return mapGatewayError(error, WRITE_ERROR)
    const parsed = parseWith(uploadHomepageLogoResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok({
      path: parsed.value.path,
      url: parsed.value.publicUrl,
      cleanupPending: parsed.value.cleanupPending,
    })
  } catch {
    return err('network', WRITE_ERROR)
  }
}

export async function removeHomepageLogo(
  path: string,
): Promise<AdminResult<{ readonly pending: boolean }>> {
  try {
    const { data, error } = await getAdminClient().functions.invoke('upload-image', {
      body: { action: 'delete', kind: 'site_logo', storagePath: path },
    })
    if (error !== null) return mapGatewayError(error, DELETE_ERROR)
    const parsed = parseWith(imageDeleteResponse, data)
    if (!parsed.ok) return err('malformed', DELETE_ERROR)
    return ok({ pending: parsed.value.pending })
  } catch {
    return err('network', DELETE_ERROR)
  }
}
