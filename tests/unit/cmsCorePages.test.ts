import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { ensureCorePages, CORE_PAGE_IDS } from '../../src/admin/cms/corePages'

describe('CMS core pages', () => {
  it('seeds every protected KNC presentation surface once', () => {
    const document = emptyDocument()
    const seeded = ensureCorePages(document)

    expect(seeded.presentation.pages.map((page) => page.id)).toEqual([...CORE_PAGE_IDS])
    expect(seeded.presentation.pages.map((page) => page.path)).toEqual([
      '/',
      '/about',
      '/booking',
      '/my-bookings',
      '/privacy',
      '/terms',
    ])
    expect(ensureCorePages(seeded).presentation.pages).toHaveLength(CORE_PAGE_IDS.length)
  })

  it('preserves custom pages while repairing only missing protected pages', () => {
    const document = emptyDocument()
    document.presentation.pages.push({
      id: 'custom-page',
      kind: 'page',
      path: '/hemsida',
      name: { sv: 'Hemsida', en: 'Page' },
      title: { sv: 'Hemsida', en: 'Page' },
      description: { sv: 'Egen sida', en: 'Custom page' },
      content: {
        sv: { html: '<main><h1>Egen</h1></main>', css: { light: '', dark: '' } },
        en: { html: '<main><h1>Custom</h1></main>', css: { light: '', dark: '' } },
      },
      inMenu: true,
    })

    const seeded = ensureCorePages(document)
    expect(seeded.presentation.pages.at(-1)?.id).toBe('custom-page')
    expect(seeded.presentation.pages).toHaveLength(CORE_PAGE_IDS.length + 1)
  })

  it('ships responsive authored CSS instead of separate desktop/mobile markup trees', () => {
    const home = ensureCorePages(emptyDocument()).presentation.pages[0]
    expect(home.content.sv.html).toContain('class="knc-cms-page"')
    expect(home.content.en.html).toContain('class="knc-cms-page"')
    expect((home.content.sv.html.match(/class=/g) ?? []).length).toBe(
      (home.content.en.html.match(/class=/g) ?? []).length,
    )
    expect(home.content.sv.css.light).toContain('@media(max-width:768px)')
    expect(home.content.sv.css.light).toContain('.knc-cms-page')
  })
})
