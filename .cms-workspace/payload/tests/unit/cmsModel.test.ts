import { describe, expect, it } from 'vitest'
import { emptyDocument, defaultEmailDesign, validateDocument, validatePresentation, validateEmailDesign, isPagePath, validMediaRef, presentationCss, type CmsState } from '../../shared/cms'
import { validateMarkup, safeLink } from '../../shared/cms-markup'
import { CmsDraft, mergeDocuments, parseBackup } from '../../src/admin/cms/draft'
const policy = { siteOrigin: 'https://bladeblendstudio.se', storageOrigin: 'https://fixture.supabase.co', builtAssets: ['/icons.svg', '/og-image.png'] }
const state = (): CmsState => ({ revision: 2, fingerprint: 'a'.repeat(32), document: emptyDocument(), assets: [] })

describe('CMS document boundary', () => {
  it('accepts an empty safe draft and keeps Swedish and English independent', () => {
    const document = emptyDocument(); document.site.kicker = { sv: 'Svenska', en: 'English' }
    validateDocument(document)
    expect(document.site.kicker.en).toBe('English')
  })
  it('rejects prototype keys deep inside any imported representation', () => {
    const document = emptyDocument()
    const raw = JSON.stringify(document).replace('"styles":{}', '"styles":{"__proto__":{"base":{}}}')
    expect(() => validateDocument(JSON.parse(raw))).toThrow('Unsafe object key')
  })
  it('rejects oversized and malformed representations before persistence', () => {
    expect(() => validateDocument({ ...emptyDocument(), barbers: {} })).toThrow()
    expect(() => validateDocument({ ...emptyDocument(), presentation: { pages: {} } })).toThrow()
    expect(() => validateDocument({ ...emptyDocument(), site: { extra: { sv: 'x' } } })).toThrow()
    expect(() => validateDocument({ ...emptyDocument(), extra: 'x'.repeat(3 * 1024 * 1024) })).toThrow()
  })
  it('cannot shadow admin, auth, customer capabilities or static assets with a page', () => {
    for (const path of ['/admin', '/admin/cms', '/api/test', '/auth/confirm', '/assets/test', '/privacy', '/terms', '/a//b', '/A', '/a/../b', '/' + 'a'.repeat(64)]) expect(isPagePath(path), path).toBe(false)
    expect(isPagePath('/vara-behandlingar')).toBe(true)
    expect(isPagePath('/salongen/vanliga-fragor')).toBe(true)
  })
  it('validates bucket and canonical path rather than accepting an arbitrary URL', () => {
    expect(validMediaRef({ bucket: 'cms-library', path: '2026/image.webp' })).toBe(true)
    for (const path of ['../private', 'a/../b', '//host', 'a//b', 'image?token=x']) expect(validMediaRef({ bucket: 'gallery', path })).toBe(false)
    expect(validMediaRef({ bucket: 'private-bookings', path: 'file.webp' })).toBe(false)
  })
  it('allows safe independent mode/device styles without stylesheet injection', () => {
    const p = emptyDocument().presentation
    p.styles['home.heading'] = { base: { fontSize: '32px' }, dark: { color: '#ffffff' }, mobile: { fontSize: '24px' } }
    validatePresentation(p)
    expect(presentationCss(p)).toContain('@media(max-width:767px)')
    p.styles['home.heading'] = { base: { color: 'red;}body{display:none' } }
    expect(() => validatePresentation(p)).toThrow()
  })
  it('never lets email styling remove or duplicate server-owned detail/CTA sections', () => {
    const design = defaultEmailDesign(); validateEmailDesign(design)
    design.order = ['title', 'intro', 'note', 'contact', 'title', 'intro']
    expect(() => validateEmailDesign(design)).toThrow()
    const unsafe = defaultEmailDesign(); unsafe.palettes.dark.text = 'red" onclick="alert(1)'
    expect(() => validateEmailDesign(unsafe)).toThrow()
  })
})

describe('CMS authored markup', () => {
  it('keeps rich semantic content, safe SVG and responsive styles', () => {
    const value = validateMarkup('<main id="intro"><h1>Hello <em>world</em></h1><a href="#intro">Top</a><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" /></svg></main>', '@media(max-width:500px){h1{font-size:24px}}', policy)
    expect(value.html).toContain('<em>world</em>')
  })
  it.each(['<script>alert(1)</script>', '<img src="/og-image.png" onerror="alert(1)">', '<iframe srcdoc="x"></iframe>', '<a href="javascript:alert(1)">x</a>', '<form><input name="email"></form>', '<svg><foreignObject><div>x</div></foreignObject></svg>', '<div data-cms-node="admin">x</div>', '<div id="a" id="b">x</div>', '<div id="a"></div><p id="a">x</p>'])('rejects executable or ambiguous HTML: %s', html => {
    expect(() => validateMarkup(html, '', policy)).toThrow()
  })
  it.each(['@import "https://evil.test/a";', 'p{background:url(https://evil.test/collect)}', 'p{width:expression(alert(1))}', 'p{-moz-binding:url(x)}', 'p{background:u\\72l(https://evil.test/collect)}', 'p{color:red}</style><script>alert(1)</script>'])('rejects unsafe CSS: %s', css => {
    expect(() => validateMarkup('<p>Hello</p>', css, policy)).toThrow()
  })
  it('records exact registered storage references and disallows disguised origins', () => {
    const src = 'https://fixture.supabase.co/storage/v1/object/public/cms-library/photo.webp'
    expect(validateMarkup(`<img src="${src}" alt="Photo">`, '', policy).refs).toEqual([{ bucket: 'cms-library', path: 'photo.webp' }])
    expect(() => validateMarkup(`<img src="${src.replace('fixture.supabase.co', 'fixture.supabase.co.evil.test')}">`, '', policy)).toThrow()
    expect(safeLink('https://example.com', policy.siteOrigin)).toBe(true)
    expect(safeLink('//evil.test', policy.siteOrigin)).toBe(false)
  })
  it('retains newlines and adds isolation to external tab links', () => {
    const result = validateMarkup('<p>A<br>B</p><a href="https://example.com" target="_blank">Link</a>', '', policy)
    expect(result.html).toContain('<br>'); expect(result.html).toContain('noopener noreferrer')
  })
})

describe('CMS draft durability', () => {
  it('groups typing, retains independent changes and implements real undo/redo', () => {
    const draft = new CmsDraft(state())
    draft.change(d => { d.site.kicker = { sv: 'A' } }, 'text', 1000)
    draft.change(d => { d.site.kicker = { sv: 'AB' } }, 'text', 1100)
    draft.undo(); expect(draft.dirty).toBe(false)
    draft.redo(); expect(draft.document.site.kicker?.sv).toBe('AB')
    draft.undo(); draft.change(d => { d.site.hours = { en: 'Open' } }); expect(draft.canRedo).toBe(false)
  })
  it('unknown outcomes replay exactly one immutable attempt, not newer edits', () => {
    const draft = new CmsDraft(state()); draft.change(d => { d.site.kicker = { sv: 'First' } })
    const request = draft.request(() => '00000000-0000-4000-8000-000000000001')
    draft.change(d => { d.site.kicker = { sv: 'Second' } }); draft.rejected(false)
    expect(draft.request()).toEqual(request)
    draft.acknowledge({ revision: 3, fingerprint: 'b'.repeat(32), requestId: request.requestId, document: request.document })
    expect(draft.document.site.kicker?.sv).toBe('Second'); expect(draft.dirty).toBe(true)
    expect(draft.request().baseRevision).toBe(3)
  })
  it('a definitive rejection permits a corrected attempt with a new identity', () => {
    const draft = new CmsDraft(state()); const original = draft.request(() => 'first')
    draft.rejected(true); draft.change(d => { d.site.kicker = { sv: 'Corrected' } })
    const next = draft.request(() => 'second'); expect(next.requestId).not.toBe(original.requestId)
  })
  it('backs up the active draft and immutable attempt, scoped to its owner', () => {
    const draft = new CmsDraft(state()); draft.change(d => { d.site.kicker = { sv: 'Live' } })
    draft.request(() => '00000000-0000-4000-8000-000000000001')
    const raw = JSON.stringify(draft.backup('owner-1'))
    const recovered = new CmsDraft(state()); recovered.restore(parseBackup(raw, 'owner-1'))
    expect(recovered.document).toEqual(draft.document); expect(recovered.pending).toEqual(draft.pending)
    expect(() => parseBackup(raw, 'other-owner')).toThrow()
  })
  it('merges independent copy edits and makes same-field conflicts explicit', () => {
    const base = emptyDocument(); base.site.kicker = { sv: 'Initial', en: 'Initial' }
    const local = structuredClone(base), remote = structuredClone(base)
    local.site.kicker.sv = 'Local'; remote.site.kicker.en = 'Remote'
    const disjoint = mergeDocuments(base, local, remote)
    expect(disjoint.conflicts).toHaveLength(0); expect(disjoint.document.site.kicker).toEqual({ sv: 'Local', en: 'Remote' })
    remote.site.kicker.sv = 'Other'
    expect(mergeDocuments(base, local, remote).conflicts).toHaveLength(1)
    expect(mergeDocuments(base, local, remote, { 'site.kicker.sv': 'remote' }).document.site.kicker.sv).toBe('Other')
  })
})
