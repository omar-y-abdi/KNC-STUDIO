// Vite-only browser harness for admin state and CMS regressions. It imports source modules directly
// and supplies inert in-memory seams, so no production auth, write adapter, or Supabase request runs.

import { h, render } from 'preact'
import { AdminShell } from '../../src/admin/AdminShell'
import { buildAdminStyles } from '../../src/admin/adminStyles'
import { palette } from '../../src/booking/bookingStyles'
import { ok } from '../../src/admin/types'
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
