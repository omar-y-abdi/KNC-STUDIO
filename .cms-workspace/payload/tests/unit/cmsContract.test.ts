import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string): string => readFileSync(resolve(path), 'utf8')

describe('unified CMS integration contract', () => {
  it('routes the owner to an independently gated studio without replacing the session lifecycle', () => {
    const app = source('src/admin/AdminApp.tsx')
    expect(app).toContain('useAdminSession')
    expect(app).toContain('/admin/cms')
    expect(app).toContain("gate.profile.role === 'owner'")
  })

  it('gives the owner one editing entrance, retaining operational views and barber self service', () => {
    const shell = source('src/admin/AdminShell.tsx')
    expect(shell).toContain('/admin/cms/')
    for (const component of ['ScheduleView', 'BookingsView', 'ServicesView', 'SettingsView', 'ProfileView']) {
      expect(shell).toContain(component)
    }
    expect(shell).not.toContain("case 'site':")
    expect(shell).not.toContain("case 'about':")
    expect(shell).not.toContain("case 'mail':")
  })

  it('has an additive migration and a dedicated authenticated publication boundary', () => {
    expect(existsSync('supabase/migrations/20260915030000_unified_cms.sql')).toBe(true)
    expect(existsSync('supabase/functions/cms-studio/index.ts')).toBe(true)
  })

  it('makes authored pages reachable through both the browser router and the real Worker', () => {
    expect(source('src/app/Root.tsx')).toContain('CmsPublicPage')
    expect(source('src/worker.ts')).toContain('serveCmsPage')
  })
})
