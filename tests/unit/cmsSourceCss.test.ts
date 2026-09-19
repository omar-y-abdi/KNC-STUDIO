import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { validateMarkup } from '../../shared/cms-markup'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}

it.each(['privacy', 'terms'])('accepts the original %s stylesheet without removing it', (page) => {
  const html = readFileSync(new URL(`../../public/${page}.html`, import.meta.url), 'utf8')
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n')
  expect(css.length).toBeGreaterThan(0)
  expect(() => validateMarkup('', css, policy)).not.toThrow()
})

it('parses safe custom properties and nested variable fallbacks', () => {
  const css = ':root{--surface:#fff;--space:12px}main{color:var(--fg,var(--fallback,#222))}'
  expect(() => validateMarkup('<main>Original site</main>', css, policy)).not.toThrow()
})

it.each([
  ':root{--image:url(https://attacker.invalid/track)}',
  'main{background:var(--image,url(https://attacker.invalid/track))}',
  ':root{--image:image-set(url(https://attacker.invalid/track) 1x)}',
  ':root{--value:expression(alert(1))}',
  ':root{--value:attr(data-secret)}',
  ':root{--cms-internal-state:1}',
  '@import "https://attacker.invalid/style.css";',
])('still rejects unsafe CSS inside variables: %s', (css) => {
  expect(() => validateMarkup('', css, policy)).toThrow()
})
