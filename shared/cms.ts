// Shared wire contract: no browser globals, credentials, HTML execution or persistence.
import {
  CmsValidationError,
  fail,
  integer,
  keys,
  list,
  object,
  validMediaRef,
  type CmsLang,
  type CmsMode,
  type MediaRef,
} from './cms-primitives.ts'
import { validateEmailDesign, type EmailDesign } from './email-design.ts'

// The editor, the tests and the Edge Functions keep importing these from here.
export { CmsValidationError, validMediaRef } from './cms-primitives.ts'
export type { CmsLang, CmsMode, MediaRef } from './cms-primitives.ts'
export { defaultEmailDesign, EMAIL_DESIGN_LIMITS, validateEmailDesign } from './email-design.ts'
export type { EmailDesign } from './email-design.ts'

export const CMS_HTML_LIMIT = 100_000
// Native captures include bounded identities and light/dark source styles.
// The complete document remains limited to 2 MiB.
export const CMS_NATIVE_HTML_LIMIT = 500_000
export type Localized = Record<CmsLang, string>
export interface MediaPlacement {
  placement: string
  ref: MediaRef
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
  trashed_at?: string | null
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
const EMAIL_VARIABLES: Record<CmsEmailName, ReadonlySet<string>> = {
  customer_confirmation: new Set([
    'business_name',
    'customer_name',
    'barber_name',
    'cancellation_hours',
  ]),
  barber_confirmation: new Set([
    'business_name',
    'customer_name',
    'barber_name',
    'booking_date',
    'booking_time',
  ]),
  customer_cancellation: new Set(['business_name', 'customer_name', 'barber_name']),
  barber_cancellation: new Set([
    'business_name',
    'customer_name',
    'barber_name',
    'booking_date',
    'booking_time',
  ]),
  customer_reminder: new Set([
    'business_name',
    'customer_name',
    'barber_name',
    'cancellation_hours',
  ]),
  customer_booking_access: new Set(['business_name']),
  auth_recovery: new Set(['business_name']),
  auth_email_change: new Set(['business_name', 'new_email']),
  auth_invite: new Set(['business_name']),
}
const EMAIL_VARIABLE = /\{([a-z_]+)\}/g
function emailVariables(value: string): Set<string> {
  return new Set(
    [...value.matchAll(EMAIL_VARIABLE)]
      .map((match) => match[1])
      .filter((variable): variable is string => variable !== undefined),
  )
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
  /** New authored pages own their complete layout, including a freely editable header/footer. */
  layout?: 'independent'
}
const REGION_NAMES = ['home-before', 'home-after', 'about-before', 'about-after'] as const
export type CmsRegion = (typeof REGION_NAMES)[number]
const COPY_GROUPS = [
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

const SITE_KEYS = [
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
const ABOUT_KEYS = [
  'eyebrow',
  'heading',
  'intro',
  'galleryTitle',
  'cutsTitle',
  'stylistsTitle',
  'reviewsTitle',
] as const
const SETTING_KEYS = [
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
const STYLE_KEYS = [
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
const THEME_KEYS = [
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

function text(value: unknown, path: string, max = 2000, min = 0): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0'))
    fail(path, min === 0 ? `Ange högst ${max} tecken.` : `Ange ${min}–${max} tecken.`)
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
      if (normalized.length < 1 || normalized.length > 160) fail(path, 'Ange 1–160 tecken.')
      return
    case 'business_legal_name':
      if (
        normalized.length > 160 ||
        [...normalized].some((char) => {
          const code = char.codePointAt(0) ?? 0
          return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
        })
      )
        fail(path, 'Ange ett juridiskt namn på högst 160 tecken utan radbrytningar.')
      return
    case 'business_org_number':
      if (normalized && !/^[0-9]{6}-?[0-9]{4}$/.test(normalized))
        fail(path, 'Ange organisationsnumret med tio siffror, till exempel 556677-8899.')
      return
    case 'business_email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.toLowerCase()))
        fail(path, 'Ange en giltig e-postadress.')
      return
    case 'business_phone_display':
      if (normalized.length > 80) fail(path, 'Ange högst 80 tecken.')
      return
    case 'business_phone_tel': {
      const phone = normalized.replace(/[\s().-]/g, '')
      if (phone && !/^\+?[0-9]{3,20}$/.test(phone))
        fail(path, 'Ange telefonlänken med 3–20 siffror, gärna med +46 först.')
      return
    }
    case 'business_postal_code': {
      const postalCode = normalized.replace(/\s/g, '')
      if (!/^[0-9]{5}$/.test(postalCode)) fail(path, 'Ange postnumret med fem siffror.')
      return
    }
    case 'business_maps_href':
      if (normalized && !/^https:\/\/[^\s]+$/.test(normalized))
        fail(path, 'Ange kartlänken som en https://-adress utan mellanslag.')
      return
    case 'seo_title_sv':
    case 'seo_title_en':
      if (normalized.length < 1 || normalized.length > 120) fail(path, 'Ange 1–120 tecken.')
      return
    case 'seo_description_sv':
    case 'seo_description_en':
      if (normalized.length < 1 || normalized.length > 500) fail(path, 'Ange 1–500 tecken.')
      return
  }
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
export function isPagePath(path: string): boolean {
  if (path === '/') return true
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
function validCssValue(value: string): boolean {
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
    const native = typeof v['html'] === 'string' && v['html'].includes('data-knc-native="1"')
    text(v['html'], `${path}.html`, native ? CMS_NATIVE_HTML_LIMIT : CMS_HTML_LIMIT)
    localizedStyles(v['css'], `${path}.css`)
  }
  for (const raw of pages) {
    const page = object(raw, 'page')
    keys(
      page,
      ['id', 'kind', 'path', 'name', 'title', 'description', 'content', 'inMenu', 'layout'],
      'page',
    )
    const id = text(page['id'], 'page.id', 36)
    if (!UUID.test(id)) fail('page.id', 'Invalid page identity')
    ids.push(id)
    const path = text(page['path'], 'page.path', 100)
    if (page['kind'] === 'privacy' || page['kind'] === 'terms') {
      if (path !== `/${page['kind']}`) fail(path, 'Legal page path is fixed')
    } else if (page['kind'] !== 'page' || !isPagePath(path))
      fail(path, 'Reserved or invalid page path')
    if (
      page['layout'] !== undefined &&
      (page['layout'] !== 'independent' ||
        page['kind'] !== 'page' ||
        ['/', '/about', '/booking', '/my-bookings', '/privacy', '/terms'].includes(path))
    )
      fail('page.layout', 'Independent layouts are only allowed on authored pages')
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
    fail('document', 'Utkastet är större än 2 MiB. Ta bort innehåll som inte behövs.')
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
    const template = email['template'] as CmsEmailName
    emailIds.push(`${template}:${email['lang']}`)
    for (const key of ['subject', 'title']) text(email[key], `email.${key}`, 120, 1)
    text(email['preheader'], 'email.preheader', 180, 1)
    for (const key of ['intro', 'note']) text(email[key], `email.${key}`, 800, 1)
    text(email['cta_label'], 'email.cta_label', 80, 1)
    if (email['section_title'] !== null) text(email['section_title'], 'email.section_title', 120, 1)
    if (email['contact_lead'] !== null) text(email['contact_lead'], 'email.contact_lead', 240, 1)
    for (const key of [
      'subject',
      'preheader',
      'title',
      'intro',
      'section_title',
      'note',
      'cta_label',
      'contact_lead',
    ]) {
      const value = email[key]
      if (typeof value !== 'string') continue
      for (const variable of emailVariables(value))
        if (!EMAIL_VARIABLES[template].has(variable))
          fail(`email.${template}.${key}`, `Okänd platshållare {${variable}}.`)
    }
    if (email['design'] !== null) validateEmailDesign(email['design'])
  }
  unique(emailIds, 'emails')
  validatePresentation(d['presentation'])
}
export function validateCompleteDocument(
  value: unknown,
  authoritative: Pick<CmsDocument, 'site' | 'about' | 'settings' | 'emails'>,
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

  for (const key of Object.keys(authoritative.settings))
    if (!Object.hasOwn(document.settings, key))
      fail(`settings.${key}`, 'Required setting is missing')

  const emailIds = new Map(
    document.emails.map((email) => [`${email.template}:${email.lang}`, email]),
  )
  for (const email of authoritative.emails) {
    const key = `${email.template}:${email.lang}`
    const path = `emails.${email.template}.${email.lang}`
    const draft = emailIds.get(key)
    if (!draft) {
      fail(path, 'Required email variant is missing')
      continue
    }
    for (const field of [
      'subject',
      'preheader',
      'title',
      'intro',
      'section_title',
      'note',
      'cta_label',
      'contact_lead',
    ] as const) {
      const before = email[field]
      const after = draft[field]
      if (typeof before !== 'string') continue
      const required = emailVariables(before)
      const present = typeof after === 'string' ? emailVariables(after) : new Set<string>()
      for (const variable of required)
        if (!present.has(variable))
          fail(`${path}.${field}`, `Platshållaren {${variable}} måste finnas kvar.`)
    }
  }
}
export function mediaUrl(ref: MediaRef, supabaseUrl: string): string {
  const media = { bucket: ref.bucket, path: ref.path }
  if (!validMediaRef(media)) throw new CmsValidationError('media', 'Invalid reference')
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${media.bucket}/${media.path.split('/').map(encodeURIComponent).join('/')}`
}
export function mediaKey(ref: MediaRef): string {
  return `${ref.bucket}/${ref.path}`
}
export function documentMediaPlacements(document: CmsDocument): MediaPlacement[] {
  const placements: MediaPlacement[] = []

  for (const [id, image] of Object.entries(document.presentation.images))
    placements.push({ placement: `presentation.images:${id}`, ref: image.ref })
  for (const [id, font] of Object.entries(document.presentation.fonts ?? {}))
    placements.push({ placement: `presentation.fonts:${id}`, ref: font.ref })
  for (const image of document.gallery)
    placements.push({
      placement: `gallery:${image.id}`,
      ref: { bucket: 'gallery', path: image.storage_path },
    })
  for (const [id, path] of Object.entries(document.photos))
    placements.push({
      placement: `photos:${id}`,
      ref: { bucket: 'barber-photos', path },
    })

  const logo = document.settings['homepage_logo_path']
  if (logo)
    placements.push({
      placement: 'settings:homepage_logo_path',
      ref: { bucket: 'gallery', path: logo },
    })

  for (const email of document.emails)
    if (email.design?.logo)
      placements.push({
        placement: `emails:${email.template}:${email.lang}:logo`,
        ref: email.design.logo,
      })

  return placements
}
export function documentMedia(document: CmsDocument): MediaRef[] {
  const refs = documentMediaPlacements(document).map(({ ref }) => ref)
  return [...new Map(refs.map((ref) => [mediaKey(ref), ref])).values()]
}
export function validateDocumentMedia(
  document: CmsDocument,
  assets: readonly CmsAsset[],
  authoredPlacements: readonly MediaPlacement[] = [],
): void {
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
    requireAsset(font.ref, `presentation.fonts.${id}`, 'font', 'fonts/')
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
  authoredPlacements.forEach(({ ref, placement }) => requireAsset(ref, placement, 'image'))
  // Archived media is governed by internal_cms_assert_media_publishable, which compares against
  // the authoritative head under the publication lock.
}
