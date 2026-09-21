import { describe, expect, it } from 'vitest'
import { syncLayout } from '../../src/admin/cms/responsiveStyles'
import { repairDesktopCss } from '../../shared/cms-device-css'
import { siteThemeCss, themeStyleValue } from '../../shared/site-theme'
import { emptyPresentation } from '../../shared/cms'

describe('independent device geometry', () => {
  it('repairs only the old desktop ID-rule breakpoint, retaining source class breakpoints', () => {
    const fixed = repairDesktopCss(
      '@media(max-width:1440px){#knc-about{translate:10px 0!important}}@media(max-width:1440px){.source{display:none}}',
    )
    expect(fixed).toContain('@media (min-width:769px){#knc-about')
    expect(fixed).toContain('@media (max-width:1440px){.source')
    expect(repairDesktopCss(fixed)).toBe(fixed)
  })
  it('shares geometry across themes without copying colors or affecting mobile', () => {
    const next = syncLayout(
      '',
      '@media(min-width:769px){#review{translate:10px 0!important;color:red!important}}',
      '@media(max-width:768px){#review{translate:-3px 0!important}}#review{color:white}',
    )
    expect(next).toContain('@media (min-width:769px){#review{translate:10px 0!important}}')
    expect(next).toContain('@media (max-width:768px){#review{translate:-3px 0!important}}')
    expect(next).toContain('color:white')
    expect(next).not.toContain('color:red')
  })
  it('removes reset geometry from the other theme without erasing unrelated rules', () => {
    const before = '@media(min-width:769px){#review{translate:10px 0!important}}'
    expect(syncLayout(before, '', before + '#review{color:white}')).not.toContain('translate')
    expect(syncLayout(before, '', before + '#review{color:white}')).toContain('color:white')
  })
})

describe('site theme defaults and owner overrides', () => {
  it('binds original defaults with their exact fallback, without rewriting bespoke colors', () => {
    expect(themeStyleValue('background', 'rgb(255, 255, 255)', 'light')).toBe(
      'var(--knc-background,rgb(255, 255, 255))',
    )
    expect(themeStyleValue('color', '#123456', 'light')).toBe('#123456')
    expect(themeStyleValue('font-family', 'Georgia, serif', 'light')).toBe(
      'var(--knc-fontFamily,Georgia, serif)',
    )
    expect(themeStyleValue('background', 'var(--knc-background,#fff)', 'light')).toBe(
      'var(--knc-background,#fff)',
    )
  })
  it('emits only explicitly configured theme values', () => {
    const p = emptyPresentation()
    p.themes.light = { background: '#f0e4d4', fontFamily: 'Georgia, serif' }
    expect(siteThemeCss(p, 'light')).toContain('--knc-background:#f0e4d4')
    expect(siteThemeCss(p, 'dark')).not.toContain('--knc-background')
  })
})
