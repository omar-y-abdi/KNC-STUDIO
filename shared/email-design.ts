import { fail, integer, keys, list, object, validMediaRef, type CmsMode, type MediaRef } from './cms-primitives.ts'

export const EMAIL_PARTS = ['title', 'intro', 'details', 'note', 'cta', 'contact'] as const
export type EmailPart = (typeof EMAIL_PARTS)[number]
export interface EmailPalette {
  background: string
  surface: string
  text: string
  muted: string
  border: string
  button: string
  buttonText: string
}
export interface EmailDesign {
  palettes: Record<CmsMode, EmailPalette>
  font: 'system' | 'serif' | 'sans'
  width: number
  radius: number
  padding: number
  titleSize: number
  textSize: number
  defaultMode: CmsMode
  order: EmailPart[]
  logo: MediaRef | null
}
/** Shared editor and server bounds; neither side may silently drift. */
export const EMAIL_DESIGN_LIMITS = {
  width: [320, 800],
  radius: [0, 40],
  padding: [12, 60],
  titleSize: [20, 48],
  textSize: [12, 24],
} as const

export function defaultEmailDesign(): EmailDesign {
  return {
    palettes: {
      light: {
        background: '#f4f3f0',
        surface: '#ffffff',
        text: '#202124',
        muted: '#62646b',
        border: '#dededb',
        button: '#202124',
        buttonText: '#ffffff',
      },
      dark: {
        background: '#151517',
        surface: '#1f1f21',
        text: '#f5f5f7',
        muted: '#b5b5ba',
        border: '#39393c',
        button: '#f5f5f7',
        buttonText: '#171719',
      },
    },
    font: 'system',
    width: 600,
    radius: 28,
    padding: 34,
    titleSize: 32,
    textSize: 16,
    defaultMode: 'dark',
    order: [...EMAIL_PARTS],
    logo: null,
  }
}
export function validateEmailDesign(
  value: unknown,
  path = 'email.design',
): asserts value is EmailDesign {
  const design = object(value, path)
  keys(
    design,
    [
      'palettes',
      'font',
      'width',
      'radius',
      'padding',
      'titleSize',
      'textSize',
      'defaultMode',
      'order',
      'logo',
    ],
    path,
  )
  const palettes = object(design['palettes'], path)
  keys(palettes, ['light', 'dark'], path)
  for (const mode of ['light', 'dark']) {
    const palette = object(palettes[mode], `${path}.${mode}`)
    keys(
      palette,
      ['background', 'surface', 'text', 'muted', 'border', 'button', 'buttonText'],
      path,
    )
    for (const key of ['background', 'surface', 'text', 'muted', 'border', 'button', 'buttonText'])
      if (!/^#[0-9a-f]{6}$/i.test(String(palette[key]))) fail(path, 'Expected six-digit colors')
  }
  if (
    !['system', 'serif', 'sans'].includes(String(design['font'])) ||
    !['light', 'dark'].includes(String(design['defaultMode']))
  )
    fail(path, 'Unsupported font or mode')
  for (const [key, [min, max]] of Object.entries(EMAIL_DESIGN_LIMITS))
    integer(design[key], path, min, max)
  const order = list(design['order'], path, EMAIL_PARTS.length)
  if (
    order.length !== EMAIL_PARTS.length ||
    new Set(order).size !== order.length ||
    order.some((part) => !EMAIL_PARTS.includes(part as EmailPart))
  )
    fail(path, 'Every email section must occur exactly once')
  if (design['logo'] !== null && !validMediaRef(design['logo']))
    fail(path, 'Invalid logo reference')
}
