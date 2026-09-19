import { expect, it } from 'vitest'
import { validateMarkup } from '../../shared/cms-markup'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}

it('preserves the original logo SVG text and its typography during publication', () => {
  const html = `<svg viewBox="0 0 460 258" role="img" aria-label="Blade &amp; Blend Studio">
    <text x="174" y="150" text-anchor="middle" font-family="'Playfair Display'"
      font-weight="700" font-size="150">B</text>
    <text x="230" y="156" text-anchor="middle" font-family="'Playfair Display'"
      font-weight="700" font-style="italic" font-size="122">&amp;</text>
    <text x="230" y="203" text-anchor="middle" font-family="'Playfair Display'"
      font-weight="400" font-size="20" letter-spacing="10">STUDIO</text>
  </svg>`
  const result = validateMarkup(html, '', policy)
  expect(result.html).toContain('>STUDIO</text>')
  expect(result.html).toContain('text-anchor="middle"')
  expect(result.html).toContain('font-style="italic"')
  expect(result.html).toContain('letter-spacing="10"')
  expect(result.refs).toEqual([])
})

it.each([
  '<text>Not an SVG element</text>',
  '<svg><text onload="alert(1)">B</text></svg>',
  '<svg><text href="https://attacker.invalid/track">B</text></svg>',
  '<svg><text style="background:url(https://attacker.invalid/track)">B</text></svg>',
  '<svg><script>alert(1)</script><text>B</text></svg>',
])('rejects executable or external SVG text content: %s', (html) => {
  expect(() => validateMarkup(html, '', policy)).toThrow()
})
