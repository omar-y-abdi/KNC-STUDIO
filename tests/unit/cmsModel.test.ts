import { MOBILE_MQ, shellPalette } from '../../src/app/shared'
import { mergeCmsPalette } from '../../src/cms/context'
import { describe, expect, it } from 'vitest'
import {
  emptyDocument,
  defaultEmailDesign,
  validateDocument,
  validatePresentation,
  validateEmailDesign,
  isPagePath,
  validMediaRef,
  presentationCss,
  type CmsState,
} from '../../shared/cms'
import { validateMarkup, safeLink } from '../../shared/cms-markup'
import { CmsDraft, mergeDocuments, parseBackup } from '../../src/admin/cms/draft'
const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
  builtAssets: ['/icons.svg', '/og-image.png'],
}
const state = (): CmsState => ({
  revision: 2,
  fingerprint: 'a'.repeat(32),
  document: emptyDocument(),
  assets: [],
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture value')
  return value
}

describe('CMS shell theme palette', () => {
  it.each([
    ['light', false, '#123456', '#654321'],
    ['dark', true, '#234567', '#fedcba'],
  ] as const)(
    'applies site-wide surface and muted tokens to %s shell semantics',
    (mode, dark, surface, muted) => {
      const presentation = emptyDocument().presentation
      presentation.themes[mode].surface = surface
      presentation.themes[mode].muted = muted

      const palette = mergeCmsPalette(presentation, shellPalette(dark), mode)

      expect(palette.surface).toBe(surface)
      expect(palette.secondarySurface).toBe(surface)
      expect(palette.navBg).toBe(surface)
      expect(palette.footer).toBe(surface)
      expect(palette.muted).toBe(muted)
      expect(palette.mobileMuted).toBe(muted)
    },
  )
})

describe('CMS document boundary', () => {
  it('accepts an empty safe draft and keeps Swedish and English independent', () => {
    const document = emptyDocument()
    document.site.kicker = { sv: 'Svenska', en: 'English' }
    validateDocument(document)
    expect(document.site.kicker.en).toBe('English')
  })
  it('rejects prototype keys deep inside any imported representation', () => {
    const document = emptyDocument()
    const raw = JSON.stringify(document).replace(
      '"styles":{}',
      '"styles":{"__proto__":{"base":{}}}',
    )
    expect(() => validateDocument(JSON.parse(raw))).toThrow('Unsafe object key')
  })
  it('rejects oversized and malformed representations before persistence', () => {
    expect(() => validateDocument({ ...emptyDocument(), barbers: {} })).toThrow()
    expect(() => validateDocument({ ...emptyDocument(), presentation: { pages: {} } })).toThrow()
    expect(() => validateDocument({ ...emptyDocument(), site: { extra: { sv: 'x' } } })).toThrow()
    expect(() =>
      validateDocument({ ...emptyDocument(), extra: 'x'.repeat(3 * 1024 * 1024) }),
    ).toThrow()
  })
  it('keeps operational booking rules outside reversible CMS documents', () => {
    expect(() =>
      validateDocument({
        ...emptyDocument(),
        settings: { cancellation_policy_hours: '1' },
      }),
    ).toThrow('Unsupported field')

    expect(() =>
      validateDocument({
        ...emptyDocument(),
        barbers: [
          {
            id: 'victor',
            name: 'Victor',
            ig: '',
            role_sv: '',
            role_en: '',
            bio_sv: '',
            bio_en: '',
            active: false,
            sort_order: 0,
          },
        ],
      }),
    ).toThrow('Unsupported field')
  })
  it('cannot shadow admin, auth, customer capabilities or static assets with a page', () => {
    for (const path of [
      '/admin',
      '/admin/cms',
      '/api/test',
      '/auth/confirm',
      '/assets/test',
      '/privacy',
      '/terms',
      '/a//b',
      '/A',
      '/a/../b',
      '/' + 'a'.repeat(64),
    ])
      expect(isPagePath(path), path).toBe(false)
    expect(isPagePath('/vara-behandlingar')).toBe(true)
    expect(isPagePath('/salongen/vanliga-fragor')).toBe(true)
  })
  it('validates bucket and canonical path rather than accepting an arbitrary URL', () => {
    expect(validMediaRef({ bucket: 'cms-library', path: '2026/image.webp' })).toBe(true)
    for (const path of ['../private', 'a/../b', '//host', 'a//b', 'image?token=x'])
      expect(validMediaRef({ bucket: 'gallery', path })).toBe(false)
    expect(validMediaRef({ bucket: 'private-bookings', path: 'file.webp' })).toBe(false)
  })
  it('allows safe independent mode/device styles without stylesheet injection', () => {
    const p = emptyDocument().presentation
    p.styles['home.heading'] = {
      base: { fontSize: '32px' },
      dark: { color: '#ffffff' },
      mobile: { fontSize: '24px' },
    }
    validatePresentation(p)
    expect(presentationCss(p)).toContain(`@media${MOBILE_MQ.replaceAll(' ', '')}`)
    p.styles['home.heading'] = { base: { color: 'red;}body{display:none' } }
    expect(() => validatePresentation(p)).toThrow()
  })
  it('never lets email styling remove or duplicate server-owned detail/CTA sections', () => {
    const design = defaultEmailDesign()
    validateEmailDesign(design)
    design.order = ['title', 'intro', 'note', 'contact', 'title', 'intro']
    expect(() => validateEmailDesign(design)).toThrow()
    const unsafe = defaultEmailDesign()
    unsafe.palettes.dark.text = 'red" onclick="alert(1)'
    expect(() => validateEmailDesign(unsafe)).toThrow()
  })
})

describe('CMS authored markup', () => {
  it('keeps rich semantic content, safe SVG and responsive styles', () => {
    const value = validateMarkup(
      '<main id="intro"><h1>Hello <em>world</em></h1><a href="#intro">Top</a><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" /></svg></main>',
      '@media(max-width:500px){h1{font-size:24px}}',
      policy,
    )
    expect(value.html).toContain('<em>world</em>')
  })
  it.each([
    '<script>alert(1)</script>',
    '<img src="/og-image.png" onerror="alert(1)">',
    '<iframe srcdoc="x"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<form><input name="email"></form>',
    '<svg><foreignObject><div>x</div></foreignObject></svg>',
    '<div data-cms-node="admin">x</div>',
    '<div id="a" id="b">x</div>',
    '<div id="a"></div><p id="a">x</p>',
  ])('rejects executable or ambiguous HTML: %s', (html) => {
    expect(() => validateMarkup(html, '', policy)).toThrow()
  })
  it.each([
    '@import "https://evil.test/a";',
    'p{background:url(https://evil.test/collect)}',
    'p{width:expression(alert(1))}',
    'p{-moz-binding:url(x)}',
    'p{background:u\\72l(https://evil.test/collect)}',
    'p{color:red}</style><script>alert(1)</script>',
  ])('rejects unsafe CSS: %s', (css) => {
    expect(() => validateMarkup('<p>Hello</p>', css, policy)).toThrow()
  })
  it('records exact registered storage references and disallows disguised origins', () => {
    const src = 'https://fixture.supabase.co/storage/v1/object/public/cms-library/photo.webp'
    expect(validateMarkup(`<img src="${src}" alt="Photo">`, '', policy).refs).toEqual([
      { bucket: 'cms-library', path: 'photo.webp' },
    ])
    expect(() =>
      validateMarkup(
        `<img src="${src.replace('fixture.supabase.co', 'fixture.supabase.co.evil.test')}">`,
        '',
        policy,
      ),
    ).toThrow()
    expect(safeLink('https://example.com', policy.siteOrigin)).toBe(true)
    expect(safeLink('//evil.test', policy.siteOrigin)).toBe(false)
  })
  it('retains newlines and adds isolation to external tab links', () => {
    const result = validateMarkup(
      '<p>A<br>B</p><a href="https://example.com" target="_blank">Link</a>',
      '',
      policy,
    )
    expect(result.html).toContain('<br>')
    expect(result.html).toContain('noopener noreferrer')
  })
})

describe('CMS draft durability', () => {
  it('groups typing, retains independent changes and implements real undo/redo', () => {
    const draft = new CmsDraft(state())
    draft.change(
      (d) => {
        d.site.kicker = { sv: 'A' }
      },
      'text',
      1000,
    )
    draft.change(
      (d) => {
        d.site.kicker = { sv: 'AB' }
      },
      'text',
      1100,
    )
    draft.undo()
    expect(draft.dirty).toBe(false)
    draft.redo()
    expect(draft.document.site.kicker?.sv).toBe('AB')
    draft.undo()
    draft.change((d) => {
      d.site.hours = { en: 'Open' }
    })
    expect(draft.canRedo).toBe(false)
  })
  it('unknown outcomes replay exactly one immutable attempt, not newer edits', () => {
    const draft = new CmsDraft(state())
    draft.change((d) => {
      d.site.kicker = { sv: 'First' }
    })
    const request = draft.request(() => '00000000-0000-4000-8000-000000000001')
    draft.change((d) => {
      d.site.kicker = { sv: 'Second' }
    })
    draft.rejected(false)
    expect(draft.request()).toEqual(request)
    draft.acknowledge({
      revision: 3,
      fingerprint: 'b'.repeat(32),
      requestId: request.requestId,
      document: request.document,
    })
    expect(draft.document.site.kicker?.sv).toBe('Second')
    expect(draft.dirty).toBe(true)
    expect(draft.request().baseRevision).toBe(3)
  })
  it('a definitive rejection permits a corrected attempt with a new identity', () => {
    const draft = new CmsDraft(state())
    const original = draft.request(() => 'first')
    draft.rejected(true)
    draft.change((d) => {
      d.site.kicker = { sv: 'Corrected' }
    })
    const next = draft.request(() => 'second')
    expect(next.requestId).not.toBe(original.requestId)
  })
  it('backs up the active draft and immutable attempt, scoped to its owner', () => {
    const draft = new CmsDraft(state())
    draft.change((d) => {
      d.site.kicker = { sv: 'Live' }
    })
    draft.request(() => '00000000-0000-4000-8000-000000000001')
    const raw = JSON.stringify(draft.backup('owner-1'))
    const recovered = new CmsDraft(state())
    recovered.restore(parseBackup(raw, 'owner-1'))
    expect(recovered.document).toEqual(draft.document)
    expect(recovered.pending).toEqual(draft.pending)
    expect(() => parseBackup(raw, 'other-owner')).toThrow()
  })
  it('merges independent copy edits and makes same-field conflicts explicit', () => {
    const base = emptyDocument()
    base.site.kicker = { sv: 'Initial', en: 'Initial' }
    const local = structuredClone(base),
      remote = structuredClone(base)
    local.site.kicker.sv = 'Local'
    remote.site.kicker.en = 'Remote'
    const disjoint = mergeDocuments(base, local, remote)
    expect(disjoint.conflicts).toHaveLength(0)
    expect(disjoint.document.site.kicker).toEqual({ sv: 'Local', en: 'Remote' })
    remote.site.kicker.sv = 'Other'
    expect(mergeDocuments(base, local, remote).conflicts).toHaveLength(1)
    expect(
      mergeDocuments(base, local, remote, { 'site.kicker.sv': 'remote' }).document.site.kicker.sv,
    ).toBe('Other')
  })
  it('merges disjoint barber edits by stable identity', () => {
    const base = emptyDocument()
    base.barbers = [
      {
        id: 'a',
        name: 'Barber A',
        ig: '',
        role_sv: '',
        role_en: '',
        bio_sv: 'A',
        bio_en: '',
        sort_order: 0,
      },
      {
        id: 'b',
        name: 'Barber B',
        ig: '',
        role_sv: '',
        role_en: '',
        bio_sv: 'B',
        bio_en: '',
        sort_order: 1,
      },
    ]
    const local = structuredClone(base),
      remote = structuredClone(base)
    required(local.barbers[0]).bio_sv = 'Local A'
    required(remote.barbers[1]).name = 'Remote B'
    const result = mergeDocuments(base, local, remote)
    expect(result.conflicts).toHaveLength(0)
    expect(result.document.barbers.find((barber) => barber.id === 'a')?.bio_sv).toBe('Local A')
    expect(result.document.barbers.find((barber) => barber.id === 'b')?.name).toBe('Remote B')
  })
  it('merges disjoint entity additions and deletions without losing either tab', () => {
    const image = (id: string, alt: string, sort_order: number) => ({
      id,
      kind: 'salon' as const,
      storage_path: `salon/${id}.webp`,
      alt,
      sort_order,
    })
    const base = emptyDocument()
    base.gallery = [
      image('00000000-0000-4000-8000-000000000001', 'One', 0),
      image('00000000-0000-4000-8000-000000000002', 'Two', 1),
    ]
    const local = structuredClone(base),
      remote = structuredClone(base)
    local.gallery = local.gallery.filter(
      (item) => item.id !== '00000000-0000-4000-8000-000000000001',
    )
    local.gallery.push(image('00000000-0000-4000-8000-000000000003', 'Local add', 2))
    required(\n      remote.gallery.find((item) => item.id === '00000000-0000-4000-8000-000000000002'),\n    ).alt =
      'Remote edit'
    remote.gallery.push(image('00000000-0000-4000-8000-000000000004', 'Remote add', 3))
    const result = mergeDocuments(base, local, remote)
    expect(result.conflicts).toHaveLength(0)
    expect(result.document.gallery.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ])
    expect(
      result.document.gallery.find((item) => item.id === '00000000-0000-4000-8000-000000000002')
        ?.alt,
    ).toBe('Remote edit')
  })
  it('merges email variants by template and language', () => {
    const email = (lang: 'sv' | 'en', subject: string) => ({
      template: 'customer_confirmation' as const,
      lang,
      subject,
      preheader: 'Preheader',
      title: 'Title',
      intro: 'Intro',
      section_title: null,
      note: 'Note',
      cta_label: 'Open',
      contact_lead: null,
      design: null,
    })
    const base = emptyDocument()
    base.emails = [email('sv', 'SV'), email('en', 'EN')]
    const local = structuredClone(base),
      remote = structuredClone(base)
    required(local.emails.find((item) => item.lang === 'sv')).subject = 'Local SV'
    required(remote.emails.find((item) => item.lang === 'en')).subject = 'Remote EN'
    const result = mergeDocuments(base, local, remote)
    expect(result.conflicts).toHaveLength(0)
    expect(result.document.emails.find((item) => item.lang === 'sv')?.subject).toBe('Local SV')
    expect(result.document.emails.find((item) => item.lang === 'en')?.subject).toBe('Remote EN')
  })
  it('combines disjoint page reorders instead of conflicting on the whole collection', () => {
    const page = (id: string, path: string) => ({
      id,
      kind: 'page' as const,
      path,
      name: { sv: path, en: path },
      title: { sv: path, en: path },
      description: { sv: '', en: '' },
      content: {
        sv: { html: '<p>SV</p>', css: { light: '', dark: '' } },
        en: { html: '<p>EN</p>', css: { light: '', dark: '' } },
      },
      inMenu: true,
    })
    const a = page('00000000-0000-4000-8000-000000000011', '/a'),
      b = page('00000000-0000-4000-8000-000000000012', '/b'),
      c = page('00000000-0000-4000-8000-000000000013', '/c'),
      d = page('00000000-0000-4000-8000-000000000014', '/d')
    const base = emptyDocument()
    base.presentation.pages = [a, b, c, d]
    const local = structuredClone(base),
      remote = structuredClone(base)
    local.presentation.pages = [
      required(local.presentation.pages[1]),
      required(local.presentation.pages[0]),
      required(local.presentation.pages[2]),
      required(local.presentation.pages[3]),
    ]
    remote.presentation.pages = [
      required(remote.presentation.pages[0]),
      required(remote.presentation.pages[1]),
      required(remote.presentation.pages[3]),
      required(remote.presentation.pages[2]),
    ]
    const result = mergeDocuments(base, local, remote)
    expect(result.conflicts).toHaveLength(0)
    expect(result.document.presentation.pages.map((item) => item.path)).toEqual([
      '/b',
      '/a',
      '/d',
      '/c',
    ])
  })
  it('conflicts only on the overlapping property of the same entity', () => {
    const base = emptyDocument()
    base.barbers = [
      {
        id: 'a',
        name: 'Barber A',
        ig: '',
        role_sv: '',
        role_en: '',
        bio_sv: 'Base',
        bio_en: '',
        sort_order: 0,
      },
    ]
    const local = structuredClone(base),
      remote = structuredClone(base)
    required(local.barbers[0]).bio_sv = 'Local'
    required(remote.barbers[0]).bio_sv = 'Remote'
    const result = mergeDocuments(base, local, remote)
    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(['barbers.a.bio_sv'])
    expect(
      mergeDocuments(base, local, remote, { 'barbers.a.bio_sv': 'remote' }).document.barbers[0]
        ?.bio_sv,
    ).toBe('Remote')
  })
})
