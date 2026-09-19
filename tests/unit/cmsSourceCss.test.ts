import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { validateMarkup } from '../../shared/cms-markup'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}

it.each(['privacy', 'terms'])('accepts the original %s CSS', (page) => {
  const html = readFileSync(new URL(`../../public/${page}.html`, import.meta.url), 'utf8')
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  const links = [...html.matchAll(/rel="stylesheet" href="([^"]+)"/g)]
  const css = [
    ...styles.map((match) => match[1]),
    ...links.map((match) =>
      readFileSync(new URL(`../../public${match[1]}`, import.meta.url), 'utf8'),
    ),
  ].join('\n')
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
