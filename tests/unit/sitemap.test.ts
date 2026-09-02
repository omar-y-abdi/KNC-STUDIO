import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('sitemap', () => {
  it('keeps canonical URLs without unverifiable static modification dates', () => {
    const sitemap = readFileSync(new URL('../../public/sitemap.xml', import.meta.url), 'utf8')

    expect(sitemap).not.toContain('<lastmod>')
    expect(sitemap).toContain('<loc>https://bladeblendstudio.se/</loc>')
    expect(sitemap).toContain('<loc>https://bladeblendstudio.se/privacy</loc>')
    expect(sitemap).toContain('<changefreq>monthly</changefreq>')
    expect(sitemap).toContain('<changefreq>yearly</changefreq>')
    expect(sitemap).toContain('<priority>1.0</priority>')
    expect(sitemap).toContain('<priority>0.4</priority>')
  })
})
