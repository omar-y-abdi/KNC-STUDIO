// Vite-only browser harness for admin state and CMS regressions. It imports source modules directly
// and supplies inert in-memory seams, so no production auth, write adapter, or Supabase request runs.

import { h, render } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { BookingFlow } from '../../src/booking/BookingFlow'
import { AboutSection } from '../../src/about/AboutSection'
import { DesktopSite, type DesktopSitePreviewPorts } from '../../src/app/DesktopSite'
import { shellPalette } from '../../src/app/shared'
import { appStrings, bookingStrings } from '../../src/i18n/index'
import { DEFAULT_BUSINESS } from '../../src/config'
import { asBarberId } from '../../src/booking/domain'
import type { CustomerProfile } from '../../src/mybookings/domain'
import { ServicesView, type ServicesViewPort } from '../../src/admin/views/ServicesView'
import { ProfileView, type ProfileViewPort } from '../../src/admin/views/ProfileView'
import { BookingsView, type BookingsViewPort } from '../../src/admin/views/BookingsView'
import type { AdminBooking, AdminService } from '../../src/admin/types'
import { GalleryManager, type GalleryManagerPort } from '../../src/admin/views/AboutView'
import { AdminShell } from '../../src/admin/AdminShell'
import { buildAdminStyles } from '../../src/admin/adminStyles'
import { palette } from '../../src/booking/bookingStyles'
import { err, ok } from '../../src/admin/types'
import { SiteView, type SiteViewPort } from '../../src/admin/views/SiteView'

interface HarnessWindow extends Window {
  __adminHarnessWrites?: readonly ReadonlyMap<string, string>[]
}

function root(): Element {
  const target = document.querySelector('#root')
  if (target === null) throw new Error('root missing')
  render(null, target)
  return target
}

const owner = {
  userId: 'e2e-owner',
  email: 'owner@example.test',
  role: 'owner' as const,
  barberId: null,
  mustChangePassword: false,
}

const barber = {
  userId: 'e2e-barber',
  email: 'barber@example.test',
  role: 'barber' as const,
  barberId: 'preview-barber',
  mustChangePassword: false,
}

export function mountAdminNavigationHarness(role: 'owner' | 'barber'): void {
  const target = root()
  render(
    h(AdminShell, {
      profile: role === 'owner' ? owner : barber,
      dark: false,
      lang: 'en',
      toggleMode: () => undefined,
      setLang: () => undefined,
      onSignOut: () => undefined,
    }),
    target,
  )
}

export function mountSiteViewHarness(): void {
  const writes: ReadonlyMap<string, string>[] = []
  ;(window as HarnessWindow).__adminHarnessWrites = writes
  const port: SiteViewPort = {
    listContent: () => Promise.resolve(ok([])),
    listSettings: () => Promise.resolve(ok(new Map())),
    saveContent: (key, lang, value) => Promise.resolve(ok({ key, lang, value })),
    saveSetting: (_key, value) => Promise.resolve(ok(value)),
    saveSettings: (values) => {
      const saved = new Map(values.map(({ key, value }) => [key, value]))
      writes.push(saved)
      return Promise.resolve(ok(saved))
    },
  }
  const target = root()
  render(
    h(SiteView, { dark: false, lang: 'en', s: buildAdminStyles(palette(false), false), port }),
    target,
  )
}

// Deferred calls model the commit itself, so a stale UI response cannot masquerade as a safe write.
function deferred() {
  let release = (): void => {
    throw new Error('gate not initialized')
  }
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

let mutationHarness:
  | {
      target: (id: string) => void
      remount: () => void
      release: () => void
      snapshot: () => { price: number; photo: string | null; status: string; writes: number }
    }
  | undefined

export function adminMutationControl(
  action: 'target' | 'remount' | 'release' | 'snapshot',
  target?: string,
) {
  if (mutationHarness === undefined) throw new Error('mutation harness not mounted')
  if (action === 'target') mutationHarness.target(target ?? 'a')
  if (action === 'remount') mutationHarness.remount()
  if (action === 'release') mutationHarness.release()
  return mutationHarness.snapshot()
}

export function mountAdminMutationHarness(
  kind: 'services' | 'profile' | 'bookings',
  failFirst = false,
): void {
  const gate = deferred()
  let writes = 0
  const beforeWrite = async (): Promise<boolean> => {
    const attempt = ++writes
    if (attempt === 1) await gate.promise
    return failFirst && attempt === 1
  }
  const service: AdminService = {
    id: 'service-a',
    barberId: 'a',
    name: 'A service',
    price: 100,
    durationMin: 30,
    active: true,
    sortOrder: 0,
    availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
  }
  let savedService = service
  let photo: { storagePath: string; url: string } | null = null
  let booking: AdminBooking = {
    id: 'booking-a',
    barberId: 'a',
    serviceName: 'A service',
    price: 100,
    durationMin: 30,
    startAt: new Date(Date.now() + 86400000),
    endAt: new Date(Date.now() + 88200000),
    customerName: 'A customer',
    method: 'email',
    phone: null,
    email: 'a@example.test',
    lang: 'en',
    status: 'confirmed',
  }
  const servicesPort: ServicesViewPort = {
    listServices: async (id) => ok(id === 'a' ? [{ ...savedService }] : []),
    updateService: async (_id, patch) => {
      if (await beforeWrite()) return err('network', 'Synthetic write failure')
      savedService = { ...savedService, ...patch }
      return ok({ ...savedService })
    },
    createService: async () => {
      throw new Error('unexpected create')
    },
    deleteService: async () => {
      throw new Error('unexpected delete')
    },
    reorderService: async () => {
      throw new Error('unexpected reorder')
    },
  }
  const profilePort: ProfileViewPort = {
    getBarberPhoto: async (id) => ok(id === 'a' && photo !== null ? { ...photo } : null),
    uploadBarberPhoto: async (_id, file) => {
      if (await beforeWrite()) return err('network', 'Synthetic write failure')
      photo = {
        storagePath: file.name,
        url: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>#${file.name}`,
      }
      return ok({ ...photo })
    },
    removeBarberPhoto: async () => {
      if (await beforeWrite()) return err('network', 'Synthetic write failure')
      photo = null
      return ok({ pending: false })
    },
  }
  const bookingsPort: BookingsViewPort = {
    listBookings: async (id) => ok(id === 'b' ? [] : [{ ...booking }]),
    cancelBooking: async () => {
      if (await beforeWrite()) return err('network', 'Synthetic write failure')
      booking = { ...booking, status: 'cancelled' }
      return ok({ id: booking.id })
    },
    deleteBookings: async () => {
      throw new Error('unexpected delete')
    },
    purgeHistory: async () => {
      throw new Error('unexpected purge')
    },
  }
  function Harness() {
    const [barberId, setBarberId] = useState('a')
    const [instance, setInstance] = useState(0)
    mutationHarness = {
      target: setBarberId,
      remount: () => setInstance((value) => value + 1),
      release: gate.release,
      snapshot: () => ({
        price: savedService.price,
        photo: photo?.storagePath ?? null,
        status: booking.status,
        writes,
      }),
    }
    const props = {
      key: instance,
      dark: false,
      lang: 'en' as const,
      s: buildAdminStyles(palette(false), false),
      barberId,
      barberName: barberId.toUpperCase(),
    }
    return kind === 'services'
      ? h(ServicesView, { ...props, port: servicesPort })
      : kind === 'profile'
        ? h(ProfileView, { ...props, port: profilePort })
        : h(BookingsView, {
            ...props,
            port: bookingsPort,
            allBarbers: false,
            barbers: [],
            heading: barberId.toUpperCase(),
            lead: '',
          })
  }
  render(h(Harness, {}), root())
}

let hydrationHarness:
  | {
      releaseLoad: () => void
      releaseWrite: () => void
      snapshot: () => { writes: number; about: string; gallery: number }
    }
  | undefined
export function adminHydrationControl(action: 'load' | 'write' | 'snapshot') {
  if (hydrationHarness === undefined) throw new Error('hydration harness not mounted')
  if (action === 'load') hydrationHarness.releaseLoad()
  if (action === 'write') hydrationHarness.releaseWrite()
  return hydrationHarness.snapshot()
}
export function mountAdminHydrationHarness(kind: 'site' | 'gallery', failLoad = false): void {
  const load = deferred(),
    write = deferred()
  let writes = 0,
    about = 'md',
    gallery = 0
  hydrationHarness = {
    releaseLoad: load.release,
    releaseWrite: write.release,
    snapshot: () => ({ writes, about, gallery }),
  }
  const props = { dark: false, lang: 'en' as const, s: buildAdminStyles(palette(false), false) }
  const port: SiteViewPort = {
    listContent: async () => {
      await load.promise
      if (failLoad) return err('network', 'Synthetic load failure')
      return ok([])
    },
    listSettings: async () => {
      await load.promise
      return ok(
        new Map([
          ['homepage_scale', 'md'],
          ['about_scale', 'md'],
        ]),
      )
    },
    saveContent: async () => {
      throw new Error('unexpected save content')
    },
    saveSetting: async (_key, value) => {
      if (++writes === 1) await write.promise
      about = value
      return ok(value)
    },
    saveSettings: async () => {
      throw new Error('unexpected presentation save')
    },
  }
  const galleryPort: GalleryManagerPort = {
    listGallery: async () => {
      await load.promise
      if (failLoad) return err('network', 'Synthetic load failure')
      return ok([])
    },
    uploadImage: async (imageKind, _file, alt, sortOrder) => {
      writes++
      gallery++
      return ok({
        id: 'new-image',
        kind: imageKind,
        alt,
        sortOrder,
        storagePath: 'new.png',
        url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      })
    },
    deleteImage: async () => {
      writes++
      gallery--
      return ok({ pending: false })
    },
  }
  render(
    kind === 'site'
      ? h(SiteView, { ...props, port })
      : h(GalleryManager, { ...props, kind: 'salon', title: 'Gallery', port: galleryPort }),
    root(),
  )
}

const publicPorts: DesktopSitePreviewPorts = {
  barbers: {
    listActive: async () => [
      {
        barber: { id: asBarberId('test-barber'), name: 'Test Barber', ig: 'test' },
        copy: null,
        photoUrl: null,
      },
    ],
  },
  services: {
    listForBarber: async () => [{ id: 'test-service', name: 'Test cut', price: 300, dur: 30 }],
  },
  booking: {
    availability: async () => ['10:00'],
    submit: async () => ({
      ok: false,
      error: { kind: 'submit', message: 'Unexpected fixture write' },
    }),
  },
  reviews: {
    list: async () => [],
    submit: async () => ({
      ok: false,
      error: { kind: 'submit', message: 'Unexpected fixture write' },
    }),
  },
  aboutContent: { overlay: async () => ({}) },
  gallery: { list: async () => [] },
}
const contacts: Record<'a' | 'b', CustomerProfile> = {
  a: { name: 'Customer A', phone: '0701111111', email: 'a@example.test' },
  b: { name: 'Customer B', phone: '0702222222', email: 'b@example.test' },
}
let setContact: ((profile: CustomerProfile | undefined) => void) | undefined
export function setHarnessContact(identity: 'a' | 'b' | 'clear'): void {
  if (setContact === undefined) throw new Error('contact harness not mounted')
  setContact(identity === 'clear' ? undefined : contacts[identity])
}
export function mountContactHarness(kind: 'booking' | 'review'): void {
  function Harness() {
    const [profile, update] = useState<CustomerProfile | undefined>()
    setContact = update
    return kind === 'booking'
      ? h(BookingFlow, {
          defaultLang: 'en',
          clock: () => new Date('2026-09-14T07:00:00Z'),
          port: publicPorts.booking,
          barbersPort: publicPorts.barbers,
          servicesPort: publicPorts.services,
          ...(profile === undefined ? {} : { initialContact: profile }),
        })
      : h(AboutSection, {
          mode: 'light',
          lang: 'en',
          port: publicPorts.reviews,
          barbersPort: publicPorts.barbers,
          aboutContentPort: publicPorts.aboutContent,
          galleryPort: publicPorts.gallery,
          challengeEnabled: false,
          ...(profile === undefined ? {} : { customerPhone: profile.phone }),
        })
  }
  render(h(Harness, {}), root())
}
let releaseCatalog: (() => void) | undefined
export function finishCatalogLoad(): void {
  releaseCatalog?.()
}
export function mountDelayedCatalogHarness(embedded: boolean): void {
  const catalog = deferred()
  releaseCatalog = catalog.release
  const ports: DesktopSitePreviewPorts = {
    ...publicPorts,
    barbers: {
      listActive: async () => {
        await catalog.promise
        return Array.from({ length: 12 }, (_, index) => ({
          barber: { id: asBarberId(`barber-${index}`), name: `Stylist ${index + 1}`, ig: 'test' },
          copy: null,
          photoUrl: null,
        }))
      },
    },
  }
  function Harness() {
    const scrollRootRef = useRef<HTMLDivElement>(null)
    const site = h(DesktopSite, {
      mode: 'light',
      lang: 'en',
      dark: false,
      c: shellPalette(false),
      business: DEFAULT_BUSINESS,
      chromeIconStyle: {},
      themeToggle: h('span', {}),
      langToggle: h('span', {}),
      tx: appStrings('en'),
      view: 'booking',
      toggleDeskBooking: () => undefined,
      scrollToAbout: () => undefined,
      findUsStyle: {},
      openCancel: () => undefined,
      openMyBookings: () => undefined,
      homepageScale: 'md',
      homepageLogo: { path: null, url: null, scale: 'md', style: 'classic' },
      aboutScale: 'md',
      bookingPopupText: bookingStrings('en'),
      previewPorts: ports,
      ...(embedded ? { scrollRootRef } : {}),
    })
    return h(
      'div',
      {
        ref: scrollRootRef,
        'data-testid': 'catalog-scroll-root',
        ...(embedded ? { style: { height: '500px', overflow: 'auto' } } : {}),
      },
      site,
    )
  }
  render(h(Harness, {}), root())
}
