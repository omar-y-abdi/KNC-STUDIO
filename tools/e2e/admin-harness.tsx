// Vite-only browser harness for admin, CMS and public-state regressions. Preview cases use inert
// ports; actual App/AdminApp cases run their real adapters with all backend I/O intercepted by runner.

import { h, render } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { BookingFlow } from '../../src/booking/BookingFlow'
import { AboutSection } from '../../src/about/AboutSection'
import { DesktopSite, type DesktopSitePreviewPorts } from '../../src/app/DesktopSite'
import { shellPalette } from '../../src/app/shared'
import { appStrings, bookingStrings, type Lang } from '../../src/i18n/index'
import { DEFAULT_BUSINESS } from '../../src/config'
import { asBarberId } from '../../src/booking/domain'
import type {
  CustomerEmailLinkResult,
  CustomerProfile,
  MyBookingsResult,
  MyCancelResult,
} from '../../src/mybookings/domain'
import { MyBookingsDialog } from '../../src/mybookings/MyBookingsDialog'
import type { MyBookingsListParams, MyBookingsPort } from '../../src/mybookings/port'
import { ServicesView, type ServicesViewPort } from '../../src/admin/views/ServicesView'
import { ProfileView, type ProfileViewPort } from '../../src/admin/views/ProfileView'
import { BookingsView, type BookingsViewPort } from '../../src/admin/views/BookingsView'
import type { AdminBooking, AdminResult, AdminService } from '../../src/admin/types'
import { GalleryManager, type GalleryManagerPort } from '../../src/admin/views/AboutView'
import { AdminShell } from '../../src/admin/AdminShell'
import { AdminApp } from '../../src/admin/AdminApp'
import { App } from '../../src/app/App'
import { buildAdminStyles } from '../../src/admin/adminStyles'
import { palette } from '../../src/booking/bookingStyles'
import { err, ok } from '../../src/admin/types'
import { SiteView, type SiteViewPort } from '../../src/admin/views/SiteView'
import { CalendarConnectButton } from '../../src/admin/calendar/CalendarConnectButton'
import type { CalendarStatus, CalendarSyncPort } from '../../src/admin/calendar/port'
import { useCalendarSync, type UseCalendarSync } from '../../src/admin/calendar/useCalendarSync'

export { h, render }

interface HarnessWindow extends Window {
  __adminHarnessWrites?: readonly ReadonlyMap<string, string>[]
}

function root(): Element {
  const target = document.querySelector('#root')
  if (target === null) throw new Error('root missing')
  render(null, target)
  return target
}

/** Real gate, Auth client and adapters. The browser runner intercepts every backend request. */
export function mountAdminAppHarness(tab: string): void {
  const target = root()
  history.replaceState({}, '', `/admin?tab=${tab}`)
  render(h(AdminApp, {}), target)
}

/** Actual root, responsive shells and shared consent state; HTTP and sockets stay inert in runner. */
export function mountPrivacyHarness(): void {
  const target = root()
  history.replaceState({}, '', '/')
  render(h(App, {}), target)
}

interface CalendarGate<T> {
  promise: Promise<AdminResult<T>>
  release: (result: AdminResult<T>) => void
}

function calendarGate<T>(): CalendarGate<T> {
  let release = (result: AdminResult<T>): void => {
    void result
    throw new Error('calendar gate not initialized')
  }
  const promise = new Promise<AdminResult<T>>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

interface CalendarProbe {
  readonly status: CalendarGate<CalendarStatus>[]
  readonly connect: CalendarGate<string>[]
  readonly disconnect: CalendarGate<undefined>[]
  readonly port: CalendarSyncPort
}

function calendarProbe(): CalendarProbe {
  const status: CalendarGate<CalendarStatus>[] = []
  const connect: CalendarGate<string>[] = []
  const disconnect: CalendarGate<undefined>[] = []
  return {
    status,
    connect,
    disconnect,
    port: {
      status: () => {
        const gate = calendarGate<CalendarStatus>()
        status.push(gate)
        return gate.promise
      },
      connectUrl: () => {
        const gate = calendarGate<string>()
        connect.push(gate)
        return gate.promise
      },
      disconnect: () => {
        const gate = calendarGate<undefined>()
        disconnect.push(gate)
        return gate.promise
      },
    },
  }
}

type CalendarPortKey = 'a' | 'b'

interface CalendarSnapshot {
  readonly activePort: CalendarPortKey
  readonly statusCalls: Readonly<Record<CalendarPortKey, number>>
  readonly connectCalls: Readonly<Record<CalendarPortKey, number>>
  readonly disconnectCalls: Readonly<Record<CalendarPortKey, number>>
}

let calendarHarness:
  | {
      readonly probes: Readonly<Record<CalendarPortKey, CalendarProbe>>
      readonly switchPort: (port: CalendarPortKey) => void
      readonly unmount: () => void
      readonly snapshot: () => CalendarSnapshot
    }
  | undefined
let setCalendarPort: ((port: CalendarPortKey) => void) | undefined
let activeCalendarPort: CalendarPortKey = 'a'

type CalendarAction = Pick<UseCalendarSync, 'connect' | 'disconnect' | 'refresh'>

let calendarActions: CalendarAction | undefined

export function calendarControl(
  action:
    | 'switch-port'
    | 'resolve-status'
    | 'resolve-connect'
    | 'resolve-disconnect'
    | 'invoke-connect'
    | 'invoke-disconnect'
    | 'invoke-refresh'
    | 'snapshot'
    | 'unmount',
  port: CalendarPortKey = 'a',
  index = 0,
  result?: unknown,
): CalendarSnapshot {
  if (calendarHarness === undefined) throw new Error('calendar harness not mounted')
  const probe = calendarHarness.probes[port]
  if (action === 'switch-port') calendarHarness.switchPort(port)
  if (action === 'unmount') calendarHarness.unmount()
  const responseGates = {
    'resolve-status': probe.status,
    'resolve-connect': probe.connect,
    'resolve-disconnect': probe.disconnect,
  }
  if (action in responseGates && !responseGates[action as keyof typeof responseGates][index])
    throw new Error(`Calendar ${action} response has no started ${port}[${index}] request`)
  if (action === 'resolve-status')
    probe.status[index]?.release(result as AdminResult<CalendarStatus>)
  if (action === 'resolve-connect') probe.connect[index]?.release(result as AdminResult<string>)
  if (action === 'resolve-disconnect')
    probe.disconnect[index]?.release(result as AdminResult<undefined>)
  if (action === 'invoke-connect') void calendarActions?.connect()
  if (action === 'invoke-disconnect') void calendarActions?.disconnect()
  if (action === 'invoke-refresh') void calendarActions?.refresh()
  return calendarHarness.snapshot()
}

export function mountCalendarHarness(
  lang: Lang = 'en',
  mode: 'component' | 'hook' = 'component',
): void {
  const probes: Record<CalendarPortKey, CalendarProbe> = { a: calendarProbe(), b: calendarProbe() }
  activeCalendarPort = 'a'
  const switchPort = (port: CalendarPortKey): void => setCalendarPort?.(port)
  const unmount = (): void => {
    setCalendarPort = undefined
    render(null, root())
  }
  calendarHarness = {
    probes,
    switchPort,
    unmount,
    snapshot: () => ({
      activePort: activeCalendarPort,
      statusCalls: { a: probes.a.status.length, b: probes.b.status.length },
      connectCalls: { a: probes.a.connect.length, b: probes.b.connect.length },
      disconnectCalls: { a: probes.a.disconnect.length, b: probes.b.disconnect.length },
    }),
  }
  function CalendarHookHarness(props: { readonly portKey: CalendarPortKey }) {
    const state = useCalendarSync(probes[props.portKey].port)
    calendarActions = {
      connect: state.connect,
      disconnect: state.disconnect,
      refresh: state.refresh,
    }
    return h('div', { 'data-testid': 'calendar-harness' }, [
      h('output', { 'data-testid': 'calendar-loading' }, String(state.loading)),
      h(
        'output',
        { 'data-testid': 'calendar-connected' },
        String(state.status?.connected ?? 'unknown'),
      ),
      h(
        'output',
        { 'data-testid': 'calendar-pending' },
        String(state.status?.disconnectPending ?? false),
      ),
      h('output', { 'data-testid': 'calendar-error' }, state.error ?? ''),
    ])
  }
  function CalendarButtonHarness(props: { readonly portKey: CalendarPortKey }) {
    calendarActions = undefined
    return h(
      'div',
      { 'data-testid': 'calendar-harness' },
      h(CalendarConnectButton, {
        s: buildAdminStyles(palette(false), false),
        dark: false,
        lang,
        port: probes[props.portKey].port,
      }),
    )
  }
  function Harness() {
    const [portKey, setPortKey] = useState<CalendarPortKey>('a')
    activeCalendarPort = portKey
    setCalendarPort = setPortKey
    return mode === 'hook'
      ? h(CalendarHookHarness, { portKey })
      : h(CalendarButtonHarness, { portKey })
  }
  render(h(Harness, {}), root())
}

interface CustomerGate<T> {
  promise: Promise<T>
  release: (result: T) => void
}

function customerGate<T>(): CustomerGate<T> {
  let release = (result: T): void => {
    void result
    throw new Error('customer gate not initialized')
  }
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

type CustomerPortKey = 'a' | 'b'

interface CustomerRequestCall {
  readonly email: string
  readonly lang: Lang
  readonly sourceEmail: string
}

interface CustomerProbe {
  readonly list: CustomerGate<MyBookingsResult>[]
  readonly request: CustomerGate<CustomerEmailLinkResult>[]
  readonly confirm: CustomerGate<CustomerEmailLinkResult>[]
  readonly cancel: CustomerGate<MyCancelResult>[]
  readonly listParams: MyBookingsListParams[]
  readonly requestCalls: CustomerRequestCall[]
  readonly confirmCodes: string[]
  readonly cancelIds: string[]
  readonly port: MyBookingsPort
}

function customerProbe(): CustomerProbe {
  const list: CustomerGate<MyBookingsResult>[] = []
  const request: CustomerGate<CustomerEmailLinkResult>[] = []
  const confirm: CustomerGate<CustomerEmailLinkResult>[] = []
  const cancel: CustomerGate<MyCancelResult>[] = []
  const listParams: CustomerProbe['listParams'] = []
  const requestCalls: CustomerRequestCall[] = []
  const confirmCodes: string[] = []
  const cancelIds: string[] = []
  const port: MyBookingsPort = {
    requestEmailLink: (email, lang, sourceEmail) => {
      const gate = customerGate<CustomerEmailLinkResult>()
      request.push(gate)
      requestCalls.push({ email, lang, sourceEmail })
      return gate.promise
    },
    confirmEmailLink: (code) => {
      const gate = customerGate<CustomerEmailLinkResult>()
      confirm.push(gate)
      confirmCodes.push(code)
      return gate.promise
    },
    requestAccess: async () => ({ ok: false, error: 'system' }),
    exchangeAccess: async () => ({ ok: false, error: 'invalid' }),
    list: (params) => {
      const gate = customerGate<MyBookingsResult>()
      list.push(gate)
      listParams.push(params)
      return gate.promise
    },
    cancel: (booking) => {
      const gate = customerGate<MyCancelResult>()
      cancel.push(gate)
      cancelIds.push(booking.id)
      return gate.promise
    },
  }
  return { list, request, confirm, cancel, listParams, requestCalls, confirmCodes, cancelIds, port }
}

interface CustomerSnapshot {
  readonly activePort: CustomerPortKey
  readonly code: string | null | undefined
  readonly listCalls: Readonly<Record<CustomerPortKey, number>>
  readonly requestCalls: Readonly<Record<CustomerPortKey, number>>
  readonly confirmCalls: Readonly<Record<CustomerPortKey, number>>
  readonly cancelCalls: Readonly<Record<CustomerPortKey, number>>
  readonly listParams: Readonly<Record<CustomerPortKey, readonly MyBookingsListParams[]>>
  readonly requestArgs: Readonly<Record<CustomerPortKey, readonly CustomerRequestCall[]>>
  readonly confirmCodes: Readonly<Record<CustomerPortKey, readonly string[]>>
  readonly cancelIds: Readonly<Record<CustomerPortKey, readonly string[]>>
}

let customerHarness:
  | {
      readonly probes: Readonly<Record<CustomerPortKey, CustomerProbe>>
      readonly switchPort: (port: CustomerPortKey) => void
      readonly setCode: (code: string | null | undefined) => void
      readonly unmount: () => void
      readonly snapshot: () => CustomerSnapshot
    }
  | undefined
let setCustomerPort: ((port: CustomerPortKey) => void) | undefined
let setCustomerCode: ((code: string | null | undefined) => void) | undefined
let activeCustomerPort: CustomerPortKey = 'a'
let activeCustomerCode: string | null | undefined

export function customerControl(
  action:
    | 'switch-port'
    | 'set-code'
    | 'resolve-list'
    | 'resolve-request'
    | 'resolve-confirm'
    | 'resolve-cancel'
    | 'unmount'
    | 'snapshot',
  port: CustomerPortKey = 'a',
  index = 0,
  result?: unknown,
): CustomerSnapshot {
  if (customerHarness === undefined) throw new Error('customer harness not mounted')
  const probe = customerHarness.probes[port]
  if (action === 'switch-port') customerHarness.switchPort(port)
  if (action === 'set-code') customerHarness.setCode(result as string | null | undefined)
  if (action === 'unmount') customerHarness.unmount()
  const responseGates = {
    'resolve-list': probe.list,
    'resolve-request': probe.request,
    'resolve-confirm': probe.confirm,
    'resolve-cancel': probe.cancel,
  }
  if (action in responseGates && !responseGates[action as keyof typeof responseGates][index])
    throw new Error(`Customer ${action} response has no started ${port}[${index}] request`)
  if (action === 'resolve-list') probe.list[index]?.release(result as MyBookingsResult)
  if (action === 'resolve-request') probe.request[index]?.release(result as CustomerEmailLinkResult)
  if (action === 'resolve-confirm') probe.confirm[index]?.release(result as CustomerEmailLinkResult)
  if (action === 'resolve-cancel') probe.cancel[index]?.release(result as MyCancelResult)
  return customerHarness.snapshot()
}

export function mountCustomerHarness(
  lang: Lang = 'en',
  code: string | null | undefined = undefined,
  accessToken: string | undefined = '',
): void {
  const probes: Record<CustomerPortKey, CustomerProbe> = { a: customerProbe(), b: customerProbe() }
  activeCustomerPort = 'a'
  activeCustomerCode = code
  const switchPort = (port: CustomerPortKey): void => setCustomerPort?.(port)
  const setCode = (next: string | null | undefined): void => setCustomerCode?.(next)
  const unmount = (): void => {
    setCustomerPort = undefined
    setCustomerCode = undefined
    render(null, root())
  }
  customerHarness = {
    probes,
    switchPort,
    setCode,
    unmount,
    snapshot: () => ({
      activePort: activeCustomerPort,
      code: activeCustomerCode,
      listCalls: { a: probes.a.list.length, b: probes.b.list.length },
      requestCalls: { a: probes.a.request.length, b: probes.b.request.length },
      confirmCalls: { a: probes.a.confirm.length, b: probes.b.confirm.length },
      cancelCalls: { a: probes.a.cancel.length, b: probes.b.cancel.length },
      listParams: { a: [...probes.a.listParams], b: [...probes.b.listParams] },
      requestArgs: { a: [...probes.a.requestCalls], b: [...probes.b.requestCalls] },
      confirmCodes: { a: [...probes.a.confirmCodes], b: [...probes.b.confirmCodes] },
      cancelIds: { a: [...probes.a.cancelIds], b: [...probes.b.cancelIds] },
    }),
  }
  function Harness() {
    const [portKey, updatePort] = useState<CustomerPortKey>('a')
    const [emailLinkCode, updateCode] = useState<string | null | undefined>(code)
    activeCustomerPort = portKey
    activeCustomerCode = emailLinkCode
    setCustomerPort = updatePort
    setCustomerCode = updateCode
    return h(MyBookingsDialog, {
      mode: 'light',
      lang,
      onClose: () => undefined,
      port: probes[portKey].port,
      ...(accessToken === undefined ? {} : { accessToken }),
      ...(emailLinkCode === undefined ? {} : { emailLinkCode }),
    })
  }
  render(h(Harness, {}), root())
}

/** Mount the actual root App after placing a supplied credential URL in the address bar. */
export function mountActualAppHarness(href = '/'): void {
  const target = root()
  history.replaceState({}, '', href)
  render(h(App, {}), target)
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
export function mountContactHarness(kind: 'booking' | 'review', lang: Lang = 'en'): void {
  function Harness() {
    const [profile, update] = useState<CustomerProfile | undefined>()
    setContact = update
    return kind === 'booking'
      ? h(BookingFlow, {
          defaultLang: lang,
          clock: () => new Date('2026-09-14T07:00:00Z'),
          port: publicPorts.booking,
          barbersPort: publicPorts.barbers,
          servicesPort: publicPorts.services,
          ...(profile === undefined ? {} : { initialContact: profile }),
        })
      : h(AboutSection, {
          mode: 'light',
          lang,
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
