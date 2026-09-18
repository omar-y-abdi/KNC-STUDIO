import { describe, expect, it } from 'vitest'
import {
  prepareCanonicalSource,
  validateCanonicalProject,
  type CmsCanonicalProject,
  type CmsCanonicalSource,
} from '../../shared/cms-project'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
  builtAssets: [] as string[],
}

const trustedHtml = `
<main id="main" data-testid="legacy-preview-root" data-cms-node="legacy-main">
  <h1>Book</h1>
  <form
    class="booking-form"
    data-cms-node="booking-form-root"
    data-cms-copy="copy:booking:title"
    data-booking-form="booking"
  >
    <label for="customer-email">Email</label>
    <input id="customer-email" name="email" type="email" aria-describedby="email-help">
    <p id="email-help">We only use this for the booking.</p>
    <button
      type="button"
      data-cms-node="booking-next-button"
      data-booking-next="details"
      aria-label="Continue"
    >Continue</button>
  </form>
</main>`

const source = (): CmsCanonicalSource => ({
  schema: 1,
  pages: [
    {
      id: 'home',
      kind: 'page',
      path: '/',
      name: { sv: 'Startsida', en: 'Home' },
      title: { sv: 'Boka', en: 'Book' },
      description: { sv: '', en: '' },
      content: {
        sv: { html: trustedHtml, css: '.booking-form{display:grid}' },
        en: { html: trustedHtml, css: '.booking-form{display:grid}' },
      },
      inMenu: true,
      required: true,
      pathLocked: true,
    },
  ],
})

function prepared(): ReturnType<typeof prepareCanonicalSource> {
  return prepareCanonicalSource(source())
}

describe('canonical CMS page project', () => {
  it('bridges legacy KNC markup into stable contracts without retaining overlay metadata', () => {
    const fixture = prepared()
    const html = fixture.project.pages[0]!.content.sv.html
    expect(html).not.toContain('data-cms-node')
    expect(html).not.toContain('data-cms-copy')
    expect(html).not.toContain('data-testid')
    expect(fixture.seed.pages[0]!.contracts.sv.find((item) => item.tag === 'form')?.key).toBe(
      'booking-form-root',
    )
    expect(fixture.seed.pages[0]!.contracts.sv.find((item) => item.tag === 'button')?.key).toBe(
      'booking-next-button',
    )
  })

  it('keeps presentation editable while preserving trusted runtime contracts', () => {
    const fixture = prepared()
    const draft = structuredClone(fixture.project)
    for (const lang of ['sv', 'en'] as const) {
      draft.pages[0]!.content[lang].html = draft.pages[0]!.content[lang].html
        .replace('Continue</button>', 'Nästa</button>')
        .replace('aria-label="Continue"', 'aria-label="Nästa steg"')
      draft.pages[0]!.content[lang].css = '.booking-form{display:grid;gap:1rem}'
    }

    const result = validateCanonicalProject(draft, fixture.seed, policy)
    expect(result.project.pages[0]!.content.sv.html).toContain('Nästa</button>')
    expect(result.project.pages[0]!.content.sv.html).toContain('aria-label="Nästa steg"')
    expect(result.project.pages[0]!.content.sv.css).toContain('gap:1rem')
  })

  it.each([
    ['removing a runtime hook', (html: string) => html.replace(' data-booking-next="details"', '')],
    ['retargeting a form name', (html: string) => html.replace('name="email"', 'name="phone"')],
    ['changing an input type', (html: string) => html.replace('type="email"', 'type="text"')],
  ])('rejects %s', (_name, mutate) => {
    const fixture = prepared()
    const draft = structuredClone(fixture.project)
    draft.pages[0]!.content.sv.html = mutate(draft.pages[0]!.content.sv.html)
    expect(() => validateCanonicalProject(draft, fixture.seed, policy)).toThrow()
  })

  it('rejects removal of a protected ARIA target', () => {
    const fixture = prepared()
    const draft = structuredClone(fixture.project)
    draft.pages[0]!.content.sv.html = draft.pages[0]!.content.sv.html.replace(
      /<p[^>]*id="email-help"[^>]*>.*?<\/p>/,
      '',
    )
    expect(() => validateCanonicalProject(draft, fixture.seed, policy)).toThrow(
      /required functional element|accessibility reference/i,
    )
  })

  it('rejects moving a protected control outside its functional island', () => {
    const fixture = prepared()
    const draft = structuredClone(fixture.project)
    const html = draft.pages[0]!.content.sv.html
    const input = html.match(/<input[^>]+>/)?.[0]
    expect(input).toBeDefined()
    draft.pages[0]!.content.sv.html = html
      .replace(input!, '')
      .replace('</form>', `</form>${input}`)
    expect(() => validateCanonicalProject(draft, fixture.seed, policy)).toThrow(
      /functional island/i,
    )
  })

  it('rejects duplicated or forged contract identities', () => {
    const fixture = prepared()
    const contract = fixture.seed.pages[0]!.contracts.sv.find((item) => item.tag === 'button')!
    const draft = structuredClone(fixture.project)
    const marker = `data-cms-contract="${contract.key}"`
    draft.pages[0]!.content.sv.html = draft.pages[0]!.content.sv.html.replace(
      marker,
      'data-cms-contract="forged-contract"',
    )
    expect(() => validateCanonicalProject(draft, fixture.seed, policy)).toThrow(
      /contract/i,
    )

    const duplicated = structuredClone(fixture.project)
    const button = duplicated.pages[0]!.content.sv.html.match(
      new RegExp(`<button[^>]*${contract.key}[^>]*>.*?<\\/button>`),
    )?.[0]
    expect(button).toBeDefined()
    duplicated.pages[0]!.content.sv.html = duplicated.pages[0]!.content.sv.html.replace(
      '</form>',
      `${button}</form>`,
    )
    expect(() => validateCanonicalProject(duplicated, fixture.seed, policy)).toThrow(
      /duplicated|duplicate/i,
    )
  })

  it('does not let a custom page invent runtime forms or data hooks', () => {
    const fixture = prepared()
    const draft = structuredClone(fixture.project)
    draft.pages.push({
      id: 'custom',
      kind: 'page',
      path: '/hemsida/',
      name: { sv: 'Hemsida', en: 'Page' },
      title: { sv: 'Hemsida', en: 'Page' },
      description: { sv: '', en: '' },
      content: {
        sv: { html: '<main><div data-booking-step="barber">X</div></main>', css: '' },
        en: { html: '<main><form><input name="x"></form></main>', css: '' },
      },
      inMenu: false,
    })
    expect(() => validateCanonicalProject(draft, fixture.seed, policy)).toThrow()
  })

  it('protects server-owned legal hooks while leaving their visible text editable', () => {
    const legal: CmsCanonicalSource = {
      schema: 1,
      pages: [
        {
          id: 'privacy',
          kind: 'privacy',
          path: '/privacy',
          name: { sv: 'Integritet', en: 'Privacy' },
          title: { sv: 'Integritet', en: 'Privacy' },
          description: { sv: '', en: '' },
          content: {
            sv: {
              html: '<main><h1>Integritet</h1><span data-business-name>Blade &amp; Blend</span><div id="legal-business-details-sv"></div></main>',
              css: '',
            },
            en: {
              html: '<main><h1>Privacy</h1><span data-business-name>Blade &amp; Blend</span><div id="legal-business-details-en"></div></main>',
              css: '',
            },
          },
          inMenu: false,
          required: true,
          pathLocked: true,
        },
      ],
    }
    const fixture = prepareCanonicalSource(legal)
    const valid = structuredClone(fixture.project)
    valid.pages[0]!.content.sv.html = valid.pages[0]!.content.sv.html.replace(
      'Blade &amp; Blend',
      'Företagsnamn',
    )
    expect(() => validateCanonicalProject(valid, fixture.seed, policy)).not.toThrow()

    const broken = structuredClone(fixture.project)
    broken.pages[0]!.content.sv.html = broken.pages[0]!.content.sv.html
      .replace(' data-business-name=""', '')
      .replace(' data-business-name', '')
    expect(() => validateCanonicalProject(broken, fixture.seed, policy)).toThrow()
  })

  it('keeps operational settings outside the reversible page project contract', () => {
    const fixture = prepared()
    const invalid = { ...fixture.project, settings: { cancellation_policy_hours: '0' } }
    expect(() => validateCanonicalProject(invalid, fixture.seed, policy)).toThrow(
      'project.settings: Unsupported field',
    )
  })

  it('requires protected seed pages and paths', () => {
    const fixture = prepared()
    expect(() =>
      validateCanonicalProject({ schema: 1, pages: [] }, fixture.seed, policy),
    ).toThrow()

    const moved = structuredClone(fixture.project)
    moved.pages[0]!.path = '/moved/'
    expect(() => validateCanonicalProject(moved, fixture.seed, policy)).toThrow(
      /path cannot change/i,
    )
  })

  it('accepts an ordinary new page with one canonical responsive CSS source', () => {
    const fixture = prepared()
    const draft: CmsCanonicalProject = structuredClone(fixture.project)
    draft.pages.push({
      id: 'custom',
      kind: 'page',
      path: '/hemsida/',
      name: { sv: 'Hemsida', en: 'Page' },
      title: { sv: 'Hemsida', en: 'Page' },
      description: { sv: 'Beskrivning', en: 'Description' },
      content: {
        sv: {
          html: '<main><h1>Ny sida</h1><a href="/">Hem</a></main>',
          css: '@media(max-width:390px){main{padding:1rem}}',
        },
        en: {
          html: '<main><h1>New page</h1><a href="/">Home</a></main>',
          css: '@media(max-width:390px){main{padding:1rem}}',
        },
      },
      inMenu: true,
    })
    const result = validateCanonicalProject(draft, fixture.seed, policy)
    expect(result.project.pages.at(-1)?.path).toBe('/hemsida/')
    expect(result.project.pages.at(-1)?.content.sv.css).toContain('@media')
  })
})
