import type { SupabaseClient } from '@supabase/supabase-js'
import { CmsValidationError, validMediaRef, type CmsAsset } from '../../../shared/cms.ts'
import type { CopyRequest } from './request.ts'

const COLUMNS = 'id,bucket,path,name,alt,mime,width,height,bytes,archived,trashed_at,version'
function invalid(message: string): never {
  throw new CmsValidationError('asset', message)
}
function conflict(): never {
  throw Object.assign(new Error('Resursen har ändrats. Läs in biblioteket igen.'), {
    code: 'PT409',
  })
}

/** Called only after cms-studio authenticates the current owner. Storage's native
 * copy avoids downloading/re-encoding already verified WebP. The original is never mutated. */
export async function copyCmsAsset(body: CopyRequest, service: SupabaseClient): Promise<CmsAsset> {
  const { id, purpose } = body
  if (purpose === 'profile') {
    if (typeof body.barberId !== 'string' || !/^[a-z0-9-]{1,32}$/.test(body.barberId))
      invalid('Välj en befintlig barberare.')
    const barber = await service.from('barbers').select('id').eq('id', body.barberId).maybeSingle()
    if (barber.error) throw barber.error
    if (!barber.data) invalid('Barberaren finns inte längre.')
  } else if (body.barberId !== undefined) invalid('En barberare anges bara för profilbilder.')
  const readSource = async () => {
    const result = await service
      .from('cms_assets')
      .select(`${COLUMNS},deleting_at`)
      .eq('id', id)
      .maybeSingle()
    if (result.error) throw result.error
    const row = result.data
    if (!row || row.version !== body.version || row.archived || row.trashed_at || row.deleting_at)
      conflict()
    if (
      row.mime !== 'image/webp' ||
      row.bytes < 1 ||
      row.bytes > 512000 ||
      !validMediaRef({ bucket: row.bucket, path: row.path })
    )
      invalid('Endast registrerade och behandlade bilder kan återanvändas här.')
    return row as CmsAsset
  }
  const source = await readSource()
  const bucket = purpose === 'profile' ? 'barber-photos' : 'gallery'
  const prefix = purpose === 'profile' ? String(body.barberId) : purpose
  if (source.bucket === bucket && source.path.startsWith(`${prefix}/`)) return source
  // One immutable scoped copy per source/destination. Reusing it does not create another file.
  const path = `${prefix}/${source.id}.webp`
  const readDestination = async (): Promise<CmsAsset | null> => {
    const existing = await service
      .from('cms_assets')
      .select(`${COLUMNS},deleting_at`)
      .eq('bucket', bucket)
      .eq('path', path)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return null
    const { deleting_at: reservation, ...asset } = existing.data
    if (reservation || asset.archived || asset.trashed_at) conflict()
    return asset as CmsAsset
  }
  const existing = await readDestination()
  if (existing) {
    await readSource()
    return existing
  }
  const copied = await service.storage
    .from(source.bucket)
    .copy(source.path, path, { destinationBucket: bucket })
  if (copied.error) {
    // A competing request may have completed the same immutable scoped copy.
    // Recover only an actual conflict, never an authorization or transport failure.
    if (String(copied.error.statusCode) === '409') {
      await readSource()
      const concurrent = await readDestination()
      if (concurrent) return concurrent
    }
    throw copied.error
  }
  // Concurrent source lifecycle changes prevent draft assignment. A successfully
  // created immutable copy remains registered; never delete a possibly referenced file.
  await readSource()
  const saved = await service
    .from('cms_assets')
    .update({
      name: source.name,
      alt: source.alt,
      mime: source.mime,
      width: source.width,
      height: source.height,
      bytes: source.bytes,
    })
    .eq('bucket', bucket)
    .eq('path', path)
    .select(COLUMNS)
    .single()
  if (saved.error) throw saved.error
  if (!saved.data) invalid('Kopian lagrades men kunde inte läsas. Uppdatera biblioteket.')
  return saved.data as CmsAsset
}
