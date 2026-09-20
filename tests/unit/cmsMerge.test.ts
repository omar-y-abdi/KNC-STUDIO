import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { mergeCmsDocuments } from '../../src/admin/cms/draft'

describe('CMS three-way merge', () => {
  it.each(['local', 'remote'] as const)(
    'resolves overlapping edits with %s while retaining independent edits',
    (resolution) => {
      const base = emptyDocument()
      base.settings.business_name = 'Base'
      base.settings.business_city = 'Göteborg'
      base.settings.business_phone = '+4631123456'
      const local = structuredClone(base)
      const remote = structuredClone(base)
      local.settings.business_name = 'Local'
      local.settings.business_phone = '+4631654321'
      remote.settings.business_name = 'Remote'
      remote.settings.business_city = 'Mölndal'
      const result = mergeCmsDocuments(base, local, remote, resolution)
      expect(result.conflicts).toEqual([{ path: 'settings.business_name' }])
      expect(result.document.settings).toMatchObject({
        business_name: resolution === 'local' ? 'Local' : 'Remote',
        business_phone: '+4631654321',
        business_city: 'Mölndal',
      })
    },
  )
  it('merges independent structured edits without overwriting either tab', () => {
    const base = emptyDocument()
    base.settings.business_name = 'Base'
    base.settings.business_city = 'Göteborg'
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.settings.business_name = 'Local'
    remote.settings.business_city = 'Mölndal'

    const result = mergeCmsDocuments(base, local, remote)
    expect(result.conflicts).toEqual([])
    expect(result.document.settings.business_name).toBe('Local')
    expect(result.document.settings.business_city).toBe('Mölndal')
  })

  it('keeps page HTML atomic when both tabs edit the same variant', () => {
    const base = emptyDocument()
    const page = {
      id: '10000000-0000-4000-8000-000000000001',
      kind: 'page' as const,
      path: '/hemsida',
      name: { sv: 'Sida', en: 'Page' },
      title: { sv: 'Sida', en: 'Page' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: {
        sv: { html: '<main>base</main>', css: { light: '', dark: '' } },
        en: { html: '<main>base</main>', css: { light: '', dark: '' } },
      },
    }
    base.presentation.pages.push(page)
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.presentation.pages[0].content.sv.html = '<main>local</main>'
    remote.presentation.pages[0].content.sv.html = '<main>remote</main>'

    const result = mergeCmsDocuments(base, local, remote)
    expect(result.conflicts.some(({ path }) => path === 'presentation.pages')).toBe(true)
    expect(result.document.presentation.pages[0].content.sv.html).toBe('<main>local</main>')
  })
})
