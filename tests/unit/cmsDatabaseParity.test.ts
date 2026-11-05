import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  emptyDocument,
  SITE_KEYS,
  validateDocument,
} from '../../packages/content-contracts/src/cms'
import { SITE_TEXT_KEYS } from '../../modules/public-web/src/site/siteChrome'

// The migration that last defines internal_cms_document is the read model the database runs.
const DEFINITION = /create (?:or replace )?function public\.internal_cms_document\(\)/g
const readModel = readdirSync('supabase/migrations')
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(`supabase/migrations/${name}`, 'utf8'))
  .flatMap((sql) => [...sql.matchAll(DEFINITION)].map((match) => sql.slice(match.index)))
  .at(-1)

function siteKeysRead(definition: string | undefined): string[] {
  const site = definition?.match(
    /'site',coalesce\(\(select[^;]*?from public\.site_content\s+where key=any\(array\[([^\]]*)\]\)/,
  )?.[1]
  return site === undefined ? [] : [...site.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '')
}

describe('site copy the database reads', () => {
  it('is exactly the copy CMS publication validates and the public site renders', () => {
    expect(siteKeysRead(readModel)).toEqual([...SITE_KEYS])
    expect([...SITE_KEYS]).toEqual([...SITE_TEXT_KEYS])
  })
})

function withSubject(subject: string) {
  const document = emptyDocument()
  document.emails.push({
    template: 'customer_confirmation',
    lang: 'sv',
    subject,
    preheader: 'Bokning',
    title: 'Bokat',
    intro: 'Hej',
    section_title: null,
    note: 'Tack',
    cta_label: 'Öppna',
    contact_lead: null,
    design: null,
  })
  return document
}

function withSetting(key: string, value: string) {
  const document = emptyDocument()
  document.settings = { [key]: value }
  return document
}

function withKicker(value: string) {
  const document = emptyDocument()
  document.site = { kicker: { sv: value } }
  return document
}

// Each emoji is one code point and two UTF-16 units. PostgreSQL char_length counts code points.
const emoji = (count: number): string => '\u{1F600}'.repeat(count)

describe('length limits count characters as PostgreSQL char_length does', () => {
  it('accepts an email subject of 120 astral characters and rejects 121', () => {
    expect(() => validateDocument(withSubject(emoji(120)))).not.toThrow()
    expect(() => validateDocument(withSubject(emoji(121)))).toThrow(
      'email.subject: Ange 1–120 tecken.',
    )
  })

  it('accepts site copy of 400 astral characters and rejects 401', () => {
    expect(() => validateDocument(withKicker(emoji(400)))).not.toThrow()
    expect(() => validateDocument(withKicker(emoji(401)))).toThrow(
      'site.kicker.sv: Ange högst 400 tecken.',
    )
  })

  it('accepts a business name of 160 astral characters and rejects 161', () => {
    expect(() => validateDocument(withSetting('business_name', emoji(160)))).not.toThrow()
    expect(() => validateDocument(withSetting('business_name', emoji(161)))).toThrow(
      'settings.business_name: Ange 1–160 tecken.',
    )
  })

  it('accepts an SEO description of 500 astral characters, 1000 UTF-16 units', () => {
    expect(() => validateDocument(withSetting('seo_description_sv', emoji(500)))).not.toThrow()
    expect(() => validateDocument(withSetting('seo_description_sv', emoji(501)))).toThrow(
      'settings.seo_description_sv: Ange högst 500 tecken.',
    )
  })
})
