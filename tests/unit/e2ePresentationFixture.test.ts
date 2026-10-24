import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIXTURE_PATH,
  HARNESS_ORIGIN,
  SOURCE_URL,
  gzipFixture,
  refreshPresentation,
  sanitisePresentation,
} from '../../tools/e2e/fixtures/refresh-presentation.mjs'

const STORAGE = 'https://abcdefghijklmnop.supabase.co/storage/v1/object/public'
const RESERVED_EMAIL_DOMAIN = /@(example\.(com|org|net|se)|[a-z0-9.-]+\.(test|invalid|example))$/i
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

function rawResponse() {
  return {
    revision: 7,
    presentation: {
      pages: [
        {
          html:
            `<img src="${STORAGE}/gallery/a.webp"><a href="mailto:boka@salong.se">boka@salong.se</a>` +
            ' bekräftelse till kund@example.test',
          css: `.hero{background:url(${STORAGE}/cms-library/b.webp)}`,
        },
      ],
      copy: ['namn@exempel.se', 'https://maps.apple.com/?q=studio'],
    },
  }
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const tempFile = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'presentation-fixture-'))
  roots.push(root)
  return join(root, 'out', 'presentation.json.gz')
}

describe('sanitisePresentation', () => {
  it('moves every Supabase origin to the harness origin and keeps the storage path', () => {
    const { response, stats } = sanitisePresentation(rawResponse())
    const text = JSON.stringify(response)
    expect(text).toContain(`${HARNESS_ORIGIN}/storage/v1/object/public/gallery/a.webp`)
    expect(text).toContain(`url(${HARNESS_ORIGIN}/storage/v1/object/public/cms-library/b.webp)`)
    expect(text).not.toMatch(/supabase\.co/i)
    expect(stats.supabaseOrigins).toBe(2)
  })

  it('replaces business addresses consistently and leaves reserved example addresses alone', () => {
    const { response, stats } = sanitisePresentation(rawResponse())
    const [page] = response.presentation.pages
    expect(page.html).toContain('mailto:contact-1@example.se">contact-1@example.se</a>')
    expect(page.html).toContain('kund@example.test')
    expect(response.presentation.copy[0]).toBe('contact-2@example.se')
    expect(stats.emails).toBe(3)
  })

  it('keeps the revision and public copy untouched', () => {
    const { response } = sanitisePresentation(rawResponse())
    expect(response.revision).toBe(7)
    expect(response.presentation.copy[1]).toBe('https://maps.apple.com/?q=studio')
  })

  it('does not mutate its input and is deterministic', () => {
    const input = rawResponse()
    const first = sanitisePresentation(input)
    expect(input).toEqual(rawResponse())
    expect(gzipFixture(first.response)).toEqual(
      gzipFixture(sanitisePresentation(rawResponse()).response),
    )
  })

  it.each([null, {}, { revision: '7', presentation: {} }, { revision: 7, presentation: null }])(
    'rejects a response that is not { revision, presentation }: %j',
    (response) => {
      expect(() => sanitisePresentation(response)).toThrow(/Unexpected presentation response/)
    },
  )

  it('fails loudly when a production reference survives, as in an object key', () => {
    const response = { revision: 1, presentation: { 'https://abcdefghijklmnop.supabase.co/x': 1 } }
    expect(() => sanitisePresentation(response)).toThrow(/still references production/)
  })
})

describe('refreshPresentation', () => {
  const okResponse = () => ({ ok: true, status: 200, json: async () => rawResponse() })

  it('does one GET of the public endpoint and writes the sanitised, gzipped document', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse())
    const out = tempFile()
    const result = await refreshPresentation({ out, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(SOURCE_URL)
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ headers: { accept: 'application/json' } })
    const written = JSON.parse(gunzipSync(readFileSync(out)).toString())
    expect(written).toEqual(sanitisePresentation(rawResponse()).response)
    expect(result).toMatchObject({ out, revision: 7, supabaseOrigins: 2, emails: 3 })
  })

  it('surfaces an HTTP failure and writes nothing', async () => {
    const out = tempFile()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    await expect(refreshPresentation({ out, fetchImpl })).rejects.toThrow('HTTP 503')
    expect(existsSync(out)).toBe(false)
  })

  it('surfaces a transport failure instead of falling back to stale data', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(refreshPresentation({ out: tempFile(), fetchImpl })).rejects.toThrow(
      'network down',
    )
  })
})

describe('committed presentation fixture', () => {
  const text = gunzipSync(readFileSync(FIXTURE_PATH)).toString()
  const fixture = JSON.parse(text)

  it('is a public presentation response', () => {
    expect(Number.isInteger(fixture.revision)).toBe(true)
    expect(fixture.presentation.pages.length).toBeGreaterThan(0)
  })

  it('is already sanitised: no Supabase host and only reserved example addresses', () => {
    expect(text).not.toMatch(/supabase\.co/i)
    const addresses = text.match(EMAIL) ?? []
    expect(addresses.filter((address) => !RESERVED_EMAIL_DOMAIN.test(address))).toEqual([])
  })

  it('serves every storage URL from the harness origin', () => {
    const urls = text.match(/https:\/\/[a-z0-9.-]+\/storage\/v1\/[^"'\s)\\]*/gi) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls)
      expect(url.startsWith(`${HARNESS_ORIGIN}/storage/v1/object/public/`)).toBe(true)
  })

  it('stays within its size budget', () => {
    expect(readFileSync(FIXTURE_PATH).length).toBeLessThan(150_000)
  })

  it('is exactly what the refresh script produces from its own content', () => {
    expect(gzipFixture(sanitisePresentation(fixture).response)).toEqual(readFileSync(FIXTURE_PATH))
  })
})
