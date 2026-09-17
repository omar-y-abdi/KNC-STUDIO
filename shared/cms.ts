// Shared wire contract: no browser globals, credentials, HTML execution or persistence.
export type CmsLang = 'sv' | 'en'
export type CmsMode = 'light' | 'dark'
export type Localized = Record<CmsLang, string>
export type MediaBucket = 'gallery' | 'barber-photos' | 'cms-library'
export interface MediaRef {
  bucket: MediaBucket
  path: string
}
export interface CmsAsset extends MediaRef {
  id: string
  name: string
  alt: string
  mime: string
  width: number | null
  height: number | null
  bytes: number
  archived: boolean
  version: number
}
export interface CmsBarber {
  id: string
  name: string
  ig: string
  role_sv: string
  role_en: string
  bio_sv: string
  bio_en: string
  sort_order: number
}
export interface CmsGallery {
  id: string
  kind: 'salon' | 'cuts'
  storage_path: string
  alt: string
  sort_order: number
}
export const EMAIL_NAMES = [
  'customer_confirmation',
  'barber_confirmation',
  'customer_cancellation',
  'barber_cancellation',
  'customer_reminder',
  'customer_booking_access',
  'auth_recovery',
  'auth_email_change',
  'auth_invite',
] as const
export type CmsEmailName = (typeof EMAIL_NAMES)[number]
export const EMAIL_PARTS = ['title', 'intro', 'details', 'note', 'cta', 'contact'] as const
export type EmailPart = (typeof EMAIL_PARTS)[number]
export interface EmailPalette {
  background: string
  surface: string
  text: string
  muted: string
  border: string
  button: string
  buttonText: string
}
export interface EmailDesign {
  palettes: Record<CmsMode, EmailPalette>
  font: 'system' | 'serif' | 'sans'
  width: number
  radius: number
  padding: number
  titleSize: number
  textSize: number
  defaultMode: CmsMode
  order: EmailPart[]
  logo: MediaRef | null
}
export interface CmsEmail {
  template: CmsEmailName
  lang: CmsLang
  subject: string
  preheader: string
  title: string
  intro: string
  section_title: string | null
  note: string
  cta_label: string
  contact_lead: string | null
  design: EmailDesign | null
}
export type CssMap = Record<string, string>
export type NodeStyle = Partial<Record<'base' | CmsMode | 'desktop' | 'mobile', CssMap>>
export interface PageVariant {
  html: string
  css: Record<CmsMode, string>
}
export interface CmsPage {
  id: string
  kind: 'page' | 'privacy' | 'terms'
  path: string
  name: Localized
  title: Localized
  description: Localized
  content: Record<CmsLang, PageVariant>
  inMenu: boolean
}
export const REGION_NAMES = ['home-before', 'home-after', 'about-before', 'about-after'] as const
export type CmsRegion = (typeof REGION_NAMES)[number]
export const COPY_GROUPS = [
  'app',
  'booking',
  'about',
  'myBookings',
  'privacy',
  'calendar',
  'customerEmailLink',
] as const
export type CopyGroup = (typeof COPY_GROUPS)[number]
export interface CmsPresentation {
  fonts?: Record<string, { ref: MediaRef; name: string }>
  copy: Partial<Record<CopyGroup, Partial<Record<CmsLang, Record<string, string>>>>>
  styles: Record<string, NodeStyle>
  images: Record<string, { ref: MediaRef; alt: Localized }>
  themes: Record<CmsMode, Record<string, string>>
  pages: CmsPage[]
  regions: Partial<Record<CmsRegion, Record<CmsLang, PageVariant>>>
}
export interface CmsDocument {
  schema: 1
  site: Record<string, Partial<Localized>>
  about: Record<string, Partial<Localized>>
  settings: Record<string, string>
  barbers: CmsBarber[]
  photos: Record<string, string>
  gallery: CmsGallery[]
  emails: CmsEmail[]
  presentation: CmsPresentation
}
export interface CmsState {
  revision: number
  fingerprint: string
  document: CmsDocument
  assets: CmsAsset[]
}
export interface CmsRevision {
  revision: number
  created_at: string
  summary: string
}
export interface CmsSave {
  document: CmsDocument
  baseRevision: number
  baseFingerprint: string
  requestId: string
}
export interface CmsPublication {
  revision: number
  fingerprint: string
  requestId: string
  document: CmsDocument
}

export class CmsValidationError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'CmsValidationError'
    this.path = path
  }
}
export const SITE_KEYS = [
  'kicker',
  'hours',
  'yourDetails',
  'summary',
  'fBarber',
  'fWhen',
  'fService',
  'fTotal',
  'name',
  'namePh',
  'phone',
  'phonePh',
  'policy',
  'bookedTitle',
  'confirmSent',
  'addToCal',
] as const
export const ABOUT_KEYS = [
  'eyebrow',
  'heading',
  'intro',
  'galleryTitle',
  'cutsTitle',
  'stylistsTitle',
  'reviewsTitle',
] as const
export const SETTING_KEYS = [
  'homepage_scale',
  'about_scale',
  'homepage_logo_path',
  'homepage_logo_scale',
  'homepage_logo_style',
  'business_name',
  'business_legal_name',
  'business_org_number',
  'business_email',
  'business_phone_display',
  'business_phone_tel',
  'business_street',
  'business_postal_code',
  'business_city',
  'business_maps_href',
  'seo_title_sv',
  'seo_description_sv',
  'seo_title_en',
  'seo_description_en',
] as const
export const STYLE_KEYS = [
  'display',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'overflow',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'gap',
  'rowGap',
  'columnGap',
  'order',
  'gridTemplateColumns',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecoration',
  'textTransform',
  'color',
  'backgroundColor',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'opacity',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'transform',
  'objectFit',
] as const
export const THEME_KEYS = [
  'background',
  'surface',
  'text',
  'muted',
  'accent',
  'accentText',
  'border',
  'fontFamily',
] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NODE_ID = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/
const RESERVED =
  /^(?:admin|api|auth|login|reset|invite|assets|icons|fonts|storage|cms-media|cms-public|google-calendar|cdn-cgi)(?:\/|$)/i

function fail(path: string, message: string): never {
  throw new CmsValidationError(path, message)
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    fail(path, 'Expected an object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'Unsupported field')
}
function text(value: unknown, path: string, max = 2000, min = 0): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0'))
    fail(path, `Expected ${min}–${max} characters`)
  return value
}
function sqlBtrim(value: string): string {
  return value.replace(/^ +| +$/g, '')
}
function validateSetting(key: string, value: unknown): void {
  const path = `settings.${key}`,
    raw = text(value, path, 500),
    normalized = sqlBtrim(raw)
  switch (key) {
    case 'homepage_scale':
    case 'about_scale':
    case 'homepage_logo_scale':
      if (!['sm', 'md', 'lg', 'xl'].includes(normalized)) fail(path, 'Expected sm, md, lg or xl')
      return
    case 'homepage_logo_style':
      if (!['classic', 'monochrome'].includes(normalized))
        fail(path, 'Expected classic or monochrome')
      return
    case 'homepage_logo_path':
      if (
        normalized &&
        !/^logo\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/.test(
          normalized,
        )
      )
        fail(path, 'Invalid homepage logo path')
      return
    case 'business_name':
    case 'business_street':
    case 'business_city':
      if (normalized.length < 1 || normalized.length > 160) fail(path, 'Expected 1–160 characters')
      return
    case 'business_legal_name':
      if (
        normalized.length > 160 ||
        [...normalized].some((char) => {
          const code = char.codePointAt(0) ?? 0
          return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
        })
      )
        fail(path, 'Invalid legal business name')
      return
    case 'business_org_number':
      if (normalized && !/^[0-9]{6}-?[0-9]{4}$/.test(normalized))
        fail(path, 'Invalid business registration number')
      return
    case 'business_email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.toLowerCase()))
        fail(path, 'Invalid business email')
      return
    case 'business_phone_display':
      if (normalized.length > 80) fail(path, 'Expected at most 80 characters')
      return
    case 'business_phone_tel': {
      const phone = normalized.replace(/[\s().-]/g, '')
      if (phone && !/^\+?[0-9]{3,20}$/.test(phone)) fail(path, 'Invalid business phone')
      return
    }
    case 'business_postal_code': {
      const postalCode = normalized.replace(/\s/g, '')
      if (!/^[0-9]{5}$/.test(postalCode)) fail(path, 'Invalid business postal code')
      return
    }
    case 'business_maps_href':
      if (normalized && !/^https:\/\/[^\s]+$/.test(normalized))
        fail(path, 'Invalid business maps URL')
      return
    case 'seo_title_sv':
    case 'seo_title_en':
      if (normalized.length < 1 || normalized.length > 120) fail(path, 'Expected 1–120 characters')
      return
    case 'seo_description_sv':
    case 'seo_description_en':
      if (normalized.length < 1 || normalized.length > 500) fail(path, 'Expected 1–500 characters')
      return
  }
}
function integer(value: unknown, path: string, min: number, max: number): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail(path, `Expected an integer between ${min} and ${max}`)
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `Expected at most ${max} items`)
  return value
}
function localized(value: unknown, path: string, max: number, partial = false): void {
  const record = object(value, path)
  keys(record, ['sv', 'en'], path)
  for (const lang of ['sv', 'en'])
    if (!partial || record[lang] !== undefined) text(record[lang], `${path}.${lang}`, max)
}
function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path, 'Duplicate identity')
}
function walk(value: unknown, path = 'document', depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 30000 || depth > 24) fail(path, 'Document is too complex')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, path, depth + 1, budget)
    return
  }
  const record = object(value, path)
  for (const [key, item] of Object.entries(record)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(path, 'Unsafe object key')
    walk(item, `${path}.${key}`, depth + 1, budget)
  }
}
export function validMediaRef(value: unknown): value is MediaRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  return (
    Object.keys(ref).every((key) => key === 'bucket' || key === 'path') &&
    ['gallery', 'barber-photos', 'cms-library'].includes(String(ref['bucket'])) &&
    typeof ref['path'] === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$/.test(ref['path']) &&
    !ref['path'].includes('..') &&
    !ref['path'].includes('//')
  )
}
export function isPagePath(path: string): boolean {
  return (
    path.length <= 100 &&
    path.startsWith('/') &&
    path
      .slice(1)
      .split(/[-/]/)
      .every((part) => /^[a-z0-9]+$/.test(part)) &&
    !RESERVED.test(path.slice(1)) &&
    !/^[0-9a-f]{64}$/i.test(path.slice(1)) &&
    !['/privacy', '/terms', '/404', '/index'].includes(path)
  )
}
export function validCssValue(value: string): boolean {
  return (
    value.length <= 160 &&
    /^[a-zA-Z0-9#.,%() +\-/_]*$/.test(value) &&
    !/(?:url|expression|image-set|var)\s*\(/i.test(value)
  )
}
export function emptyPresentation(): CmsPresentation {
  return {
    copy: {},
    styles: {},
    images: {},
    themes: { light: {}, dark: {} },
    pages: [],
    regions: {},
  }
}
export function emptyDocument(): CmsDocument {
  return {
    schema: 1,
    site: {},
    about: {},
    settings: {},
    barbers: [],
    photos: {},
    gallery: [],
    emails: [],
    presentation: emptyPresentation(),
  }
}
export function defaultEmailDesign(): EmailDesign {
  return {
    palettes: {
      light: {
        background: '#f4f3f0',
        surface: '#ffffff',
        text: '#202124',
        muted: '#62646b',
        border: '#dededb',
        button: '#202124',
        buttonText: '#ffffff',
      },
      dark: {
        background: '#151517',
        surface: '#1f1f21',
        text: '#f5f5f7',
        muted: '#b5b5ba',
        border: '#39393c',
        button: '#f5f5f7',
        buttonText: '#171719',
      },
    },
    font: 'system',
    width: 600,
    radius: 28,
    padding: 34,
    titleSize: 32,
    textSize: 16,
    defaultMode: 'dark',
    order: [...EMAIL_PARTS],
    logo: null,
  }
}
export function validateEmailDesign(
  value: unknown,
  path = 'email.design',
): asserts value is EmailDesign {
  const design = object(value, path)
  keys(
    design,
    [
      'palettes',
      'font',
      'width',
      'radius',
      'padding',
      'titleSize',
      'textSize',
      'defaultMode',
      'order',
      'logo',
    ],
    path,
  )
  const palettes = object(design['palettes'], path)
  keys(palettes, ['light', 'dark'], path)
  for (const mode of ['light', 'dark']) {
    const palette = object(palettes[mode], `${path}.${mode}`)
    keys(
      palette,
      ['background', 'surface', 'text', 'muted', 'border', 'button', 'buttonText'],
      path,
    )
    for (const key of ['background', 'surface', 'text', 'muted', 'border', 'button', 'buttonText'])
      if (!/^#[0-9a-f]{6}$/i.test(String(palette[key]))) fail(path, 'Expected six-digit colors')
  }
  if (
    !['system', 'serif', 'sans'].includes(String(design['font'])) ||
    !['light', 'dark'].includes(String(design['defaultMode']))
  )
    fail(path, 'Unsupported font or mode')
  integer(design['width'], path, 320, 800)
  integer(design['radius'], path, 0, 40)
  integer(design['padding'], path, 12, 60)
  integer(design['titleSize'], path, 20, 48)
  integer(design['textSize'], path, 12, 24)
  const order = list(design['order'], path, EMAIL_PARTS.length)
  if (
    order.length !== EMAIL_PARTS.length ||
    new Set(order).size !== order.length ||
    order.some((part) => !EMAIL_PARTS.includes(part as EmailPart))
  )
    fail(path, 'Every email section must occur exactly once')
  if (design['logo'] !== null && !validMediaRef(design['logo']))
    fail(path, 'Invalid logo reference')
}
export function validatePresentation(value: unknown): asserts value is CmsPresentation {
  walk(value)
  const p = object(value, 'presentation')
  keys(p, ['copy', 'styles', 'images', 'themes', 'pages', 'regions', 'fonts'], 'presentation')
  const fonts = p['fonts'] === undefined ? {} : object(p['fonts'], 'fonts')
  if (Object.keys(fonts).length > 30) fail('fonts', 'At most 30 uploaded fonts may be registered')
  for (const [id, raw] of Object.entries(fonts)) {
    if (!UUID.test(id)) fail('fonts', 'Invalid font identity')
    const font = object(raw, 'font')
    keys(font, ['ref', 'name'], 'font')
    if (
      !validMediaRef(font['ref']) ||
      font['ref'].bucket !== 'cms-library' ||
      !font['ref'].path.endsWith('.woff2')
    )
      fail('font', 'Choose a registered WOFF2 font')
    text(font['name'], 'font.name', 160, 1)
  }
  const registeredFont = (value: unknown): boolean =>
    typeof value === 'string' &&
    value.startsWith('CMSFont-') &&
    Object.hasOwn(fonts, value.slice(8))
  const copy = object(p['copy'], 'copy')
  keys(copy, COPY_GROUPS, 'copy')
  for (const [group, rawLangs] of Object.entries(copy)) {
    const langs = object(rawLangs, `copy.${group}`)
    keys(langs, ['sv', 'en'], `copy.${group}`)
    for (const [lang, raw] of Object.entries(langs)) {
      const cells = object(raw, `copy.${group}.${lang}`)
      if (Object.keys(cells).length > 300) fail('copy', 'Too many text entries')
      for (const [key, cell] of Object.entries(cells)) {
        if (!/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(key)) fail('copy', 'Invalid key')
        text(cell, `copy.${group}.${lang}.${key}`)
      }
    }
  }
  const styles = object(p['styles'], 'styles')
  if (Object.keys(styles).length > 1500) fail('styles', 'Too many styled elements')
  for (const [id, raw] of Object.entries(styles)) {
    if (!NODE_ID.test(id)) fail('styles', 'Invalid node identity')
    const variants = object(raw, id)
    keys(variants, ['base', 'light', 'dark', 'mobile', 'desktop'], id)
    for (const rawValues of Object.values(variants)) {
      const family = object(rawValues, id)['fontFamily']
      if (typeof family === 'string' && family.startsWith('CMSFont-') && !registeredFont(family))
        fail(id, 'Font family is not registered')
    }
    for (const [variant, rawValues] of Object.entries(variants)) {
      const values = object(rawValues, id)
      keys(values, STYLE_KEYS, id)
      for (const [property, css] of Object.entries(values))
        if (!validCssValue(text(css, `${id}.${variant}.${property}`, 160)))
          fail(id, 'Unsafe CSS value')
    }
  }
  const images = object(p['images'], 'images')
  if (Object.keys(images).length > 1000) fail('images', 'Too many image assignments')
  for (const [id, raw] of Object.entries(images)) {
    if (!NODE_ID.test(id)) fail('images', 'Invalid node identity')
    const image = object(raw, id)
    keys(image, ['ref', 'alt'], id)
    if (!validMediaRef(image['ref'])) fail(id, 'Invalid media reference')
    localized(image['alt'], `${id}.alt`, 2000)
  }
  const themes = object(p['themes'], 'themes')
  keys(themes, ['light', 'dark'], 'themes')
  for (const mode of ['light', 'dark']) {
    const theme = object(themes[mode], mode)
    keys(theme, THEME_KEYS, mode)
    for (const [key, cell] of Object.entries(theme)) {
      if (key === 'fontFamily') {
        if (
          ![
            'Inter Variable, sans-serif',
            'Playfair Display, serif',
            'Arial, sans-serif',
            'Georgia, serif',
            'system-ui, sans-serif',
          ].includes(String(cell)) &&
          !registeredFont(cell)
        )
          fail(mode, 'Unsupported site font')
      } else if (!/^#[0-9a-f]{6}$/i.test(String(cell))) fail(mode, 'Expected six-digit colors')
    }
  }
  const pages = list(p['pages'], 'pages', 50)
  const ids: string[] = [],
    paths: string[] = []
  const variant = (raw: unknown, path: string): void => {
    const v = object(raw, path)
    keys(v, ['html', 'css'], path)
    text(v['html'], `${path}.html`, 100000)
    localizedStyles(v['css'], `${path}.css`)
  }
  for (const raw of pages) {
    const page = object(raw, 'page')
    keys(page, ['id', 'kind', 'path', 'name', 'title', 'description', 'content', 'inMenu'], 'page')
    const id = text(page['id'], 'page.id', 36)
    if (!UUID.test(id)) fail('page.id', 'Invalid page identity')
    ids.push(id)
    const path = text(page['path'], 'page.path', 100)
    if (page['kind'] === 'privacy' || page['kind'] === 'terms') {
      if (path !== `/${page['kind']}`) fail(path, 'Legal page path is fixed')
    } else if (page['kind'] !== 'page' || !isPagePath(path))
      fail(path, 'Reserved or invalid page path')
    paths.push(path)
    localized(page['name'], 'page.name', 80)
    localized(page['title'], 'page.title', 120)
    localized(page['description'], 'page.description', 300)
    if (typeof page['inMenu'] !== 'boolean') fail(path, 'Invalid menu state')
    const content = object(page['content'], 'page.content')
    keys(content, ['sv', 'en'], 'page.content')
    for (const lang of ['sv', 'en']) variant(content[lang], `${path}.${lang}`)
  }
  unique(ids, 'pages')
  unique(paths, 'pages')
  const regions = object(p['regions'], 'regions')
  keys(regions, REGION_NAMES, 'regions')
  for (const [name, raw] of Object.entries(regions)) {
    const langs = object(raw, name)
    keys(langs, ['sv', 'en'], name)
    for (const lang of ['sv', 'en']) variant(langs[lang], `${name}.${lang}`)
  }
}
function localizedStyles(raw: unknown, path: string): void {
  const styles = object(raw, path)
  keys(styles, ['light', 'dark'], path)
  for (const mode of ['light', 'dark']) text(styles[mode], `${path}.${mode}`, 100000)
}
export function validateDocument(value: unknown): asserts value is CmsDocument {
  walk(value)
  if (new TextEncoder().encode(JSON.stringify(value)).length > 2 * 1024 * 1024)
    fail('document', 'Maximum document size is 2 MiB')
  const d = object(value, 'document')
  keys(
    d,
    [
      'schema',
      'site',
      'about',
      'settings',
      'barbers',
      'photos',
      'gallery',
      'emails',
      'presentation',
    ],
    'document',
  )
  if (d['schema'] !== 1) fail('document.schema', 'Unsupported schema version')
  for (const [group, allowed, max] of [
    ['site', SITE_KEYS, 400],
    ['about', ABOUT_KEYS, 2000],
  ] as const) {
    const cells = object(d[group], group)
    keys(cells, allowed, group)
    for (const [key, raw] of Object.entries(cells)) localized(raw, `${group}.${key}`, max, true)
  }
  const settings = object(d['settings'], 'settings')
  keys(settings, SETTING_KEYS, 'settings')
  for (const [key, raw] of Object.entries(settings)) validateSetting(key, raw)
  const barbers = list(d['barbers'], 'barbers', 100),
    barberIds: string[] = []
  for (const raw of barbers) {
    const b = object(raw, 'barber')
    keys(b, ['id', 'name', 'ig', 'role_sv', 'role_en', 'bio_sv', 'bio_en', 'sort_order'], 'barber')
    const id = text(b['id'], 'barber.id', 32, 1)
    if (!/^[a-z0-9-]+$/.test(id)) fail('barber.id', 'Invalid identity')
    barberIds.push(id)
    text(b['name'], 'barber.name', 60, 1)
    text(b['ig'], 'barber.ig', 60)
    for (const key of ['role_sv', 'role_en']) text(b[key], key, 80)
    for (const key of ['bio_sv', 'bio_en']) text(b[key], key, 600)
    integer(b['sort_order'], id, -2147483648, 2147483647)
  }
  unique(barberIds, 'barbers')
  const photos = object(d['photos'], 'photos')
  for (const [id, path] of Object.entries(photos))
    if (
      !barberIds.includes(id) ||
      !validMediaRef({ bucket: 'barber-photos', path }) ||
      !String(path).startsWith(`${id}/`)
    )
      fail(`photos.${id}`, 'Invalid scoped photo')
  const gallery = list(d['gallery'], 'gallery', 1000),
    galleryIds: string[] = []
  for (const raw of gallery) {
    const image = object(raw, 'gallery')
    keys(image, ['id', 'kind', 'storage_path', 'alt', 'sort_order'], 'gallery')
    const id = text(image['id'], 'gallery.id', 36)
    if (!UUID.test(id)) fail('gallery.id', 'Invalid identity')
    galleryIds.push(id)
    const storagePath = String(image['storage_path'])
    if (
      !['salon', 'cuts'].includes(String(image['kind'])) ||
      !validMediaRef({ bucket: 'gallery', path: storagePath }) ||
      storagePath.length > 200
    )
      fail(id, 'Invalid gallery reference')
    text(image['alt'], `${id}.alt`, 2000)
    integer(image['sort_order'], id, -2147483648, 2147483647)
  }
  unique(galleryIds, 'gallery')
  const emails = list(d['emails'], 'emails', 18),
    emailIds: string[] = []
  for (const raw of emails) {
    const email = object(raw, 'email')
    keys(
      email,
      [
        'template',
        'lang',
        'subject',
        'preheader',
        'title',
        'intro',
        'section_title',
        'note',
        'cta_label',
        'contact_lead',
        'design',
      ],
      'email',
    )
    if (
      !EMAIL_NAMES.includes(email['template'] as CmsEmailName) ||
      !['sv', 'en'].includes(String(email['lang']))
    )
      fail('email', 'Unknown template or locale')
    emailIds.push(`${email['template']}:${email['lang']}`)
    for (const key of ['subject', 'title']) text(email[key], `email.${key}`, 120, 1)
    text(email['preheader'], 'email.preheader', 180, 1)
    for (const key of ['intro', 'note']) text(email[key], `email.${key}`, 800, 1)
    text(email['cta_label'], 'email.cta_label', 80, 1)
    if (email['section_title'] !== null) text(email['section_title'], 'email.section_title', 120, 1)
    if (email['contact_lead'] !== null) text(email['contact_lead'], 'email.contact_lead', 240, 1)
    if (email['design'] !== null) validateEmailDesign(email['design'])
  }
  unique(emailIds, 'emails')
  validatePresentation(d['presentation'])
}
export function validateCompleteDocument(
  value: unknown,
  authoritative: Pick<CmsDocument, 'site' | 'about'>,
): asserts value is CmsDocument {
  validateDocument(value)
  const document = value as CmsDocument

  for (const group of ['site', 'about'] as const) {
    for (const [key, requiredTranslations] of Object.entries(authoritative[group])) {
      const translations = document[group][key]
      if (!translations) fail(`${group}.${key}`, 'Required content is missing')
      for (const lang of ['sv', 'en'] as const)
        if (Object.hasOwn(requiredTranslations, lang) && !Object.hasOwn(translations, lang))
          fail(`${group}.${key}.${lang}`, 'Required translation is missing')
    }
  }

  for (const key of SETTING_KEYS)
    if (!Object.hasOwn(document.settings, key))
      fail(`settings.${key}`, 'Required setting is missing')

  const emailIds = new Set(document.emails.map((email) => `${email.template}:${email.lang}`))
  for (const template of EMAIL_NAMES)
    for (const lang of ['sv', 'en'] as const)
      if (!emailIds.has(`${template}:${lang}`))
        fail(`emails.${template}.${lang}`, 'Required email variant is missing')
}
export function mediaUrl(ref: MediaRef, supabaseUrl: string): string {
  const media = { bucket: ref.bucket, path: ref.path }
  if (!validMediaRef(media)) throw new CmsValidationError('media', 'Invalid reference')
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${media.bucket}/${media.path.split('/').map(encodeURIComponent).join('/')}`
}
export function mediaKey(ref: MediaRef): string {
  return `${ref.bucket}/${ref.path}`
}
export function documentMedia(document: CmsDocument): MediaRef[] {
  const refs: MediaRef[] = [
    ...Object.values(document.presentation.images).map((image) => image.ref),
    ...document.gallery.map((image) => ({ bucket: 'gallery' as const, path: image.storage_path })),
    ...Object.values(document.photos).map((path) => ({ bucket: 'barber-photos' as const, path })),
  ]
  refs.push(...Object.values(document.presentation.fonts ?? {}).map((font) => font.ref))
  const logo = document.settings['homepage_logo_path']
  if (logo) refs.push({ bucket: 'gallery', path: logo })
  for (const email of document.emails) if (email.design?.logo) refs.push(email.design.logo)
  return [...new Map(refs.map((ref) => [mediaKey(ref), ref])).values()]
}
export function validateDocumentMedia(document: CmsDocument, assets: readonly CmsAsset[]): void {
  const inventory = new Map(assets.map((asset) => [mediaKey(asset), asset]))
  const requireAsset = (
    ref: MediaRef,
    path: string,
    kind: 'image' | 'font',
    prefix?: string,
  ): void => {
    const asset = inventory.get(mediaKey(ref))
    if (!asset) fail(path, 'Referenced media is not registered')
    if (prefix && !ref.path.startsWith(prefix)) fail(path, 'Media is outside the required scope')
    if (kind === 'image' && !asset.mime.startsWith('image/')) fail(path, 'Expected an image asset')
    if (kind === 'font' && asset.mime !== 'font/woff2') fail(path, 'Expected a WOFF2 font')
  }

  for (const [id, image] of Object.entries(document.presentation.images))
    requireAsset(image.ref, `presentation.images.${id}`, 'image')
  for (const [id, font] of Object.entries(document.presentation.fonts ?? {}))
    requireAsset(font.ref, `presentation.fonts.${id}`, 'font')
  for (const [id, path] of Object.entries(document.photos))
    requireAsset({ bucket: 'barber-photos', path }, `photos.${id}`, 'image', `${id}/`)
  for (const image of document.gallery)
    requireAsset(
      { bucket: 'gallery', path: image.storage_path },
      `gallery.${image.id}.storage_path`,
      'image',
      `${image.kind}/`,
    )
  const logo = document.settings['homepage_logo_path']
  if (logo)
    requireAsset({ bucket: 'gallery', path: logo }, 'settings.homepage_logo_path', 'image', 'logo/')
  for (const email of document.emails)
    if (email.design?.logo)
      requireAsset(email.design.logo, `emails.${email.template}.${email.lang}.logo`, 'image')
}
export function cssProperty(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}
export function presentationCss(presentation: CmsPresentation): string {
  const rules: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const declarations = Object.entries(presentation.themes[mode])
      .map(([key, value]) => `--knc-cms-${cssProperty(key)}:${value}`)
      .join(';')
    if (declarations) rules.push(`[data-cms-theme="${mode}"]{${declarations}}`)
  }
  for (const [id, variants] of Object.entries(presentation.styles)) {
    if (!NODE_ID.test(id)) continue
    for (const variant of ['base', 'light', 'dark', 'desktop', 'mobile'] as const) {
      const declarations = Object.entries(variants[variant] ?? {})
        .filter(
          ([name, value]) =>
            (STYLE_KEYS as readonly string[]).includes(name) && validCssValue(value),
        )
        .map(([name, value]) => `${cssProperty(name)}:${value}!important`)
        .join(';')
      if (!declarations) continue
      const selector = `${variant === 'light' || variant === 'dark' ? `[data-cms-theme="${variant}"] ` : ''}[data-cms-node="${id}"]`
      const rule = `${selector}{${declarations}}`
      rules.push(
        variant === 'mobile'
          ? `@media(max-width:768px){${rule}}`
          : variant === 'desktop'
            ? `@media(min-width:769px){${rule}}`
            : rule,
      )
    }
  }
  return rules.join('\n')
}
