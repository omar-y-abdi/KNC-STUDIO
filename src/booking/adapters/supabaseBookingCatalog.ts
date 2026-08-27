import { getSupabase } from '../../backend/supabaseClient'
import {
  parseWith,
  publicBookingCatalogResponse,
  type PublicBarberRow,
  type PublicServiceRow,
} from '../../backend/rpcSchemas'
import type { BarberId, ServiceItem } from '../domain'
import { asBarberId } from '../domain'
import type { RosterBarber } from '../barbersPort'

const PHOTO_BUCKET = 'barber-photos'

export interface BookingCatalog {
  readonly barbers: readonly RosterBarber[]
  readonly servicesByBarber: ReadonlyMap<BarberId, readonly ServiceItem[]>
}

const EMPTY_CATALOG: BookingCatalog = { barbers: [], servicesByBarber: new Map() }
let catalogPromise: Promise<BookingCatalog> | null = null
let catalogLoading = false
const catalogListeners = new Set<() => void>()
let stopCatalogSubscription: (() => void) | null = null

function toRoster(row: PublicBarberRow & { readonly photo_path: string | null }): RosterBarber {
  const photoUrl =
    row.photo_path === null
      ? null
      : getSupabase().storage.from(PHOTO_BUCKET).getPublicUrl(row.photo_path).data.publicUrl
  return {
    barber: { id: asBarberId(row.id), name: row.name, ig: row.ig },
    copy: { roleSv: row.role_sv, roleEn: row.role_en, bioSv: row.bio_sv, bioEn: row.bio_en },
    photoUrl,
  }
}

function toService(row: PublicServiceRow): ServiceItem {
  return { id: row.id, name: row.name, price: row.price, dur: row.duration_min }
}

async function loadBookingCatalog(): Promise<BookingCatalog> {
  const { data, error } = await getSupabase().rpc('public_booking_catalog')
  if (error !== null) throw new Error('public booking catalog unavailable')
  const parsed = parseWith(publicBookingCatalogResponse, data)
  if (!parsed.ok) throw new Error('public booking catalog malformed')

  const servicesByBarber = new Map<BarberId, ServiceItem[]>()
  for (const row of parsed.value.services) {
    const barberId = asBarberId(row.barber_id)
    const services = servicesByBarber.get(barberId) ?? []
    services.push(toService(row))
    servicesByBarber.set(barberId, services)
  }
  return {
    barbers: parsed.value.barbers.map(toRoster),
    servicesByBarber,
  }
}

/** Shared in-flight/result cache: roster, photos, and services resolve through one RPC request. */
export function cachedBookingCatalog(): Promise<BookingCatalog> {
  if (catalogPromise !== null) return catalogPromise
  catalogLoading = true
  catalogPromise = loadBookingCatalog()
    .catch((error: unknown) => {
      catalogPromise = null
      throw error
    })
    .finally(() => {
      catalogLoading = false
    })
  return catalogPromise
}

/** Force a current read, while coalescing callers that refresh during the same in-flight request. */
export function refreshBookingCatalog(): Promise<BookingCatalog> {
  if (catalogLoading && catalogPromise !== null) return catalogPromise
  catalogPromise = null
  return cachedBookingCatalog()
}

/** Start truthful catalog hydration before a visitor opens booking. */
export function preloadBookingCatalog(): void {
  void cachedBookingCatalog().catch(() => EMPTY_CATALOG)
}

function startCatalogSubscription(): () => void {
  const client = getSupabase()
  let channel = client.channel('public-booking-catalog')
  const changed = (): void => {
    catalogPromise = null
    for (const listener of catalogListeners) listener()
  }
  for (const table of ['barbers', 'barber_photos', 'services']) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, changed)
  }
  channel.subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

/** Invalidate cached truth when an admin changes any catalog-owned table. */
export function subscribeBookingCatalog(onChange: () => void): () => void {
  catalogListeners.add(onChange)
  stopCatalogSubscription ??= startCatalogSubscription()
  return () => {
    catalogListeners.delete(onChange)
    if (catalogListeners.size === 0) {
      stopCatalogSubscription?.()
      stopCatalogSubscription = null
    }
  }
}
