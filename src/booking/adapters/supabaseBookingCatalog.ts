import { getSupabase } from '../../backend/supabaseClient'
import {
  parseWith,
  publicBookingCatalogResponse,
  type PublicBarberRow,
  type PublicServiceRow,
} from '../../backend/rpcSchemas'
import type { BarberId, ServiceItem } from '../domain'
import { asBarberId } from '../domain'
import { parseDateIso } from '../calendar'
import type { RosterBarber } from '../barbersPort'

const PHOTO_BUCKET = 'barber-photos'

export interface BookingCatalog {
  readonly barbers: readonly RosterBarber[]
  readonly servicesByBarber: ReadonlyMap<BarberId, readonly ServiceItem[]>
  /** Authoritative weekday sets kept beside display-only `ServiceItem` values. */
  readonly weekdaysByServiceId: ReadonlyMap<string, readonly number[]>
}

export const BOOKING_CATALOG_TTL_MS = 30_000

const EMPTY_CATALOG: BookingCatalog = {
  barbers: [],
  servicesByBarber: new Map(),
  weekdaysByServiceId: new Map(),
}
let catalogValue: BookingCatalog | null = null
let catalogPromise: Promise<BookingCatalog> | null = null
let catalogRefreshPromise: Promise<BookingCatalog> | null = null
let catalogLoadedAt: number | null = null
let catalogListenerRefresh: Promise<void> | null = null
let catalogRevalidateRequested = false
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
  const weekdaysByServiceId = new Map<string, readonly number[]>()
  for (const row of parsed.value.services) {
    const barberId = asBarberId(row.barber_id)
    const services = servicesByBarber.get(barberId) ?? []
    services.push(toService(row))
    servicesByBarber.set(barberId, services)
    weekdaysByServiceId.set(row.id, row.available_weekdays)
  }
  return {
    barbers: parsed.value.barbers.map(toRoster),
    servicesByBarber,
    weekdaysByServiceId,
  }
}

/** Filter cached catalog rows for the customer-selected local date without another network read. */
export function servicesForBookingDate(
  catalog: BookingCatalog,
  barberId: BarberId,
  dateIso: string,
): readonly ServiceItem[] {
  const parts = parseDateIso(dateIso)
  if (parts === null) return []
  const weekday = new Date(parts.year, parts.month - 1, parts.day).getDay()
  return (catalog.servicesByBarber.get(barberId) ?? []).filter((service) =>
    catalog.weekdaysByServiceId.get(service.id)?.includes(weekday),
  )
}

function startCatalogLoad(): Promise<BookingCatalog> {
  if (catalogPromise !== null) return catalogPromise

  const request = loadBookingCatalog()
    .then((catalog) => {
      catalogValue = catalog
      catalogLoadedAt = Date.now()
      return catalog
    })
    .finally(() => {
      if (catalogPromise === request) catalogPromise = null
    })
  catalogPromise = request
  return request
}

/** Shared in-flight/result cache: roster, photos, and services resolve through one RPC request. */
export function cachedBookingCatalog(): Promise<BookingCatalog> {
  if (catalogRefreshPromise !== null) return catalogRefreshPromise
  if (
    catalogValue !== null &&
    catalogLoadedAt !== null &&
    Date.now() - catalogLoadedAt < BOOKING_CATALOG_TTL_MS
  ) {
    return Promise.resolve(catalogValue)
  }
  return startCatalogLoad()
}

/**
 * Force a read that begins after any older in-flight load has settled. This matters when a
 * Realtime subscription is first established: an idle preload may have completed before an owner
 * edit, so reusing that preload would preserve the exact missed-change gap the refresh is closing.
 */
export function refreshBookingCatalog(): Promise<BookingCatalog> {
  if (catalogRefreshPromise !== null) return catalogRefreshPromise

  const previous = catalogPromise
  const refresh = (
    previous === null
      ? Promise.resolve()
      : previous.then(
          () => undefined,
          () => undefined,
        )
  )
    .then(() => {
      catalogValue = null
      catalogLoadedAt = null
      return startCatalogLoad()
    })
    .finally(() => {
      if (catalogRefreshPromise === refresh) catalogRefreshPromise = null
    })
  catalogRefreshPromise = refresh
  return refresh
}

/** Start truthful catalog hydration before a visitor opens booking. */
export function preloadBookingCatalog(): void {
  void cachedBookingCatalog().catch(() => EMPTY_CATALOG)
}

function revalidateCatalogListeners(): void {
  catalogRevalidateRequested = true
  if (catalogListenerRefresh !== null) return

  catalogListenerRefresh = (async () => {
    while (catalogRevalidateRequested) {
      catalogRevalidateRequested = false
      try {
        await refreshBookingCatalog()
      } catch {
        continue
      }
    }
    for (const listener of catalogListeners) listener()
  })().finally(() => {
    catalogListenerRefresh = null
    if (catalogRevalidateRequested) revalidateCatalogListeners()
  })
}

function startCatalogSubscription(): () => void {
  const client = getSupabase()
  let channel = client.channel('public-booking-catalog')
  const changed = (): void => revalidateCatalogListeners()
  for (const table of ['barbers', 'barber_photos', 'services']) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, changed)
  }
  let initialRevalidated = false
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' && !initialRevalidated) {
      initialRevalidated = true
      // Close the idle-preload gap only after the socket is live, so edits before subscription
      // are covered by this authoritative read and later edits are covered by Realtime.
      revalidateCatalogListeners()
    }
  })
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
