import { describe, expect, it } from 'vitest'
import { modeCss } from '../../shared/cms-mode-css'

describe('explicit CMS theme', () => {
  const css =
    ':root{color:black;background:white}@media(prefers-color-scheme:dark){:root{color:white;background:black}}@media(max-width:768px){main{padding:24px}}'
  it('uses the selected dark palette independently of OS preference', () => {
    const resolved = modeCss(css, 'dark')
    expect(resolved).not.toContain('prefers-color-scheme')
    expect(resolved).toContain(':root{color:white;background:black}')
    expect(resolved).toContain('@media(max-width:768px)')
  })
  it('does not import dark palette rules into the light variant', () => {
    expect(modeCss(css, 'light')).not.toContain('background:black')
    expect(modeCss(css, 'light')).toContain('background:white')
  })
})
