import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import { inspectWoff2 } from '../_shared/cmsFont.ts'
import { ImageValidationError } from './processImage.ts'

export class CmsMediaUnavailable extends Error {}
type DecodedImage = { bytes: Uint8Array; width: number; height: number }
type Decode = (input: Uint8Array, profile: boolean) => Promise<DecodedImage>
const COLUMNS = 'id,bucket,path,name,alt,mime,width,height,bytes,archived,trashed_at,version'

export async function handleCmsUpload(
  form: FormData,
  actor: string,
  service: SupabaseClient,
  decode: Decode,
  json: (body: unknown, status: number) => Response,
): Promise<Response> {
  const failure = (error: string, status: number, message: string): Response =>
    json({ ok: false, error, message }, status)
  try {
    const owner = await service.rpc('internal_cms_assert_owner', { p_actor: actor })
    if (owner.error)
      return failure(
        owner.error.code === '42501' ? 'forbidden' : 'unavailable',
        owner.error.code === '42501' ? 403 : 503,
        'Filbiblioteket kräver ett aktivt ägarkonto och den aktuella CMS-migrationen.',
      )
    const field = (key: string): FormDataEntryValue | null =>
      form.getAll(key).length === 1 ? form.get(key) : null
    if ([...form.keys()].some((key) => !['kind', 'file', 'purpose', 'barberId'].includes(key)))
      return failure('invalid_payload', 422, 'Uppladdningen innehåller okända fält.')
    const file = field('file'),
      purpose = field('purpose'),
      barberId = field('barberId')
    if (
      !(file instanceof File) ||
      field('kind') !== 'cms_asset' ||
      typeof purpose !== 'string' ||
      !['library', 'salon', 'cuts', 'logo', 'profile'].includes(purpose)
    )
      return failure('invalid_payload', 422, 'Välj en fil och en giltig plats i biblioteket.')
    if (!file.size || file.size > 5 * 1024 * 1024)
      return failure('file_too_large', 413, 'Filen måste vara större än 0 byte och högst 5 MiB.')
    if (purpose === 'profile') {
      if (typeof barberId !== 'string' || !/^[a-z0-9-]{1,32}$/.test(barberId))
        return failure('invalid_profile', 422, 'Välj den barberare som profilbilden tillhör.')
      const barber = await service.from('barbers').select('id').eq('id', barberId).maybeSingle()
      if (barber.error)
        return failure('unavailable', 503, 'Personaluppgifterna kunde inte kontrolleras.')
      if (!barber.data)
        return failure('not_found', 404, 'Barberaren finns inte längre. Läs in personalen igen.')
    } else if (form.has('barberId'))
      return failure('invalid_payload', 422, 'En barberare anges bara för profilbilder.')
    const input = new Uint8Array(await file.arrayBuffer())
    const font =
      /\.woff2$/i.test(file.name) ||
      file.type === 'font/woff2' ||
      (input.length >= 4 && new DataView(input.buffer).getUint32(0) === 0x774f4632)
    let processed: Uint8Array,
      width: number | null = null,
      height: number | null = null
    try {
      if (font) {
        if (purpose !== 'library')
          return failure('invalid_image', 422, 'Denna plats kräver en bild, inte ett typsnitt.')
        inspectWoff2(input)
        processed = input
      } else {
        const image = await decode(input, purpose === 'profile')
        processed = image.bytes
        width = image.width
        height = image.height
      }
    } catch (error) {
      if (error instanceof CmsMediaUnavailable)
        return failure(
          'image_processor_unavailable',
          503,
          'Bildbehandlingen är tillfälligt otillgänglig. Ingen placering har ändrats.',
        )
      if (error instanceof ImageValidationError && error.code !== 'unsupported_image')
        return failure(
          error.code,
          422,
          error.code === 'image_too_large'
            ? 'Bilden har för hög upplösning. Välj en bild med högst 25 megapixlar.'
            : 'Bilden blir för stor efter komprimering. Välj en mindre eller enklare bild.',
        )
      return failure(
        font ? 'invalid_font' : 'invalid_image',
        422,
        font
          ? 'Typsnittet kunde inte avkodas som en fullständig WOFF2-fil.'
          : 'Bilden kunde inte avkodas. Välj en fullständig JPEG-, PNG-, WebP-, AVIF- eller HEIC-bild.',
      )
    }
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
          ? String(barberId)
          : purpose
    const path = `${prefix}/${crypto.randomUUID()}.${font ? 'woff2' : 'webp'}`
    const mime = font ? 'font/woff2' : 'image/webp'
    const stored = await service.storage
      .from(bucket)
      .upload(path, processed, { contentType: mime, upsert: false, cacheControl: '31536000' })
    if (stored.error)
      return failure(
        'storage_failed',
        503,
        'Filen kunde inte lagras. Ingen sida eller profil har ändrats.',
      )
    // The storage insert trigger registers immutable objects atomically, including legacy uploads.
    const asset = await service
      .from('cms_assets')
      .update({
        name: (file.name.replaceAll('\0', '').trim() || 'Uppladdad fil').slice(0, 160),
        mime,
        width,
        height,
        bytes: processed.byteLength,
      })
      .eq('bucket', bucket)
      .eq('path', path)
      .select(COLUMNS)
      .single()
    if (asset.error || !asset.data)
      return failure(
        'metadata_failed',
        503,
        'Filen lagrades men filuppgifterna kunde inte bekräftas. Läs in biblioteket igen innan du försöker ladda upp på nytt.',
      )
    return json({ ok: true, asset: asset.data }, 200)
  } catch {
    return failure(
      'unavailable',
      503,
      'Uppladdningen kunde inte bekräftas. Ditt sidutkast är oförändrat.',
    )
  }
}
