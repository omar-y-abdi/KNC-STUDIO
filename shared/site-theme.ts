import { generate, parse, walk } from 'css-tree'
import type { CmsMode, CmsPresentation } from './cms'

export const SITE_THEME_DEFAULTS = {
  light: {
    background: '#ffffff',
    surface: '#f1f0ec',
    text: '#1c1c1e',
    muted: '#666666',
    accent: '#1c1c1e',
    accentText: '#ffffff',
    border: '#e6e6e6',
    fontFamily: 'Inter Variable, sans-serif',
  },
  dark: {
    background: '#1c1c1e',
    surface: '#262629',
    text: '#f5f5f7',
    muted: '#999999',
    accent: '#f5f5f7',
    accentText: '#1c1c1e',
    border: '#39393b',
    fontFamily: 'Inter Variable, sans-serif',
  },
} as const

/** Variables have original fallbacks: an untouched theme preserves the existing design. */
export function siteThemeCss(presentation: CmsPresentation, mode: CmsMode): string {
  const theme = presentation.themes[mode]
  const body = [
    ['background', 'background'],
    ['color', 'text'],
    ['font-family', 'fontFamily'],
  ]
    .filter(([, key]) => key && theme[key])
    .map(([property, key]) => `${property}:var(--knc-${key})`)
    .join(';')
  return `body{${body}}:root{${Object.entries(theme)
    .map(([key, value]) => `--knc-${key}:${value}`)
    .join(';')}}`
}

/** Tokenize code-owned defaults only. Owner-authored element CSS remains authoritative. */
export function themeStyleValue(property: string, value: string, mode: CmsMode): string {
  if (value.includes('var(--knc-')) return value
  if (property === 'font-family' && value !== 'inherit') return `var(--knc-fontFamily,${value})`
  if (
    !['color', 'background', 'background-color', 'border', 'fill', 'stroke'].includes(property) &&
    !property.startsWith('border-')
  )
    return value
  const palette = SITE_THEME_DEFAULTS[mode]
  const normalize = (color: string): string => color.toLowerCase().replace(/\s/g, '')
  const colors = new Map<string, string>()
  const add = (key: string, ...values: string[]): void => {
    for (const color of values) colors.set(normalize(color), key)
  }
  if (property.startsWith('border')) {
    add(
      'border',
      'rgba(0,0,0,.08)',
      'rgba(0,0,0,0.08)',
      'rgba(0,0,0,.1)',
      'rgba(0,0,0,0.1)',
      'rgba(0,0,0,.18)',
      'rgba(0,0,0,0.18)',
      'rgba(255,255,255,.1)',
      'rgba(255,255,255,0.1)',
      'rgba(255,255,255,.13)',
      'rgba(255,255,255,0.13)',
      'rgba(255,255,255,.22)',
      'rgba(255,255,255,0.22)',
    )
  } else if (property.startsWith('background')) {
    add(
      'background',
      palette.background,
      mode === 'light' ? '#fff' : '#1c1c1e',
      mode === 'light' ? 'rgb(255,255,255)' : 'rgb(28,28,30)',
    )
    add(
      'surface',
      palette.surface,
      '#f4f3f0',
      '#faf9f6',
      '#f6f6f4',
      '#eceae5',
      '#242427',
      '#2c2c2e',
      '#161618',
      'rgb(241,240,236)',
      'rgb(250,249,246)',
      'rgb(38,38,41)',
      'rgb(44,44,46)',
      'rgb(36,36,39)',
    )
    add('accent', palette.accent, mode === 'light' ? 'rgb(28,28,30)' : 'rgb(245,245,247)')
  } else {
    add('text', palette.text, mode === 'light' ? 'rgb(28,28,30)' : 'rgb(245,245,247)')
    add(
      'accentText',
      palette.accentText,
      mode === 'light' ? '#fff' : '#1c1c1e',
      mode === 'light' ? 'rgb(255,255,255)' : 'rgb(28,28,30)',
    )
    add(
      'muted',
      'rgba(0,0,0,.6)',
      'rgba(0,0,0,0.6)',
      'rgba(255,255,255,.55)',
      'rgba(255,255,255,0.55)',
    )
  }
  return value.replace(/#[\da-f]{3,8}\b|rgba?\([^)]*\)/gi, (color) => {
    const key = colors.get(normalize(color))
    return key ? `var(--knc-${key},${color})` : color
  })
}

export function themeDeclarations(css: string, mode: CmsMode): string {
  const tree = parse(css, { context: 'declarationList' })
  walk(tree, {
    visit: 'Declaration',
    enter(declaration) {
      const value = parse(
        themeStyleValue(declaration.property, generate(declaration.value), mode),
        { context: 'value' },
      )
      if (value.type === 'Value') declaration.value = value
    },
  })
  return generate(tree)
}
