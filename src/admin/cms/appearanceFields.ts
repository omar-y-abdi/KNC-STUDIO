// Presentation presets that live in the CMS document's `settings`, next to the business details.
// Keys and values are the ones `validateSetting` accepts (shared/cms.ts) and the public site reads
// (src/site/adapters/supabaseSiteChrome.ts); an absent key means the default shown first-selected.

import { SIZE_PRESETS, type SizePreset } from '../../site/siteChrome'

export interface AppearanceOption {
  readonly value: string
  readonly label: string
}

export interface AppearanceField {
  readonly key: 'homepage_logo_scale' | 'homepage_scale' | 'homepage_logo_style' | 'about_scale'
  readonly label: string
  readonly fallback: string
  readonly options: readonly AppearanceOption[]
}

const SIZE_LABEL: Readonly<Record<SizePreset, string>> = {
  sm: 'Liten',
  md: 'Normal',
  lg: 'Stor',
  xl: 'Extra stor',
}

const sizeOptions: readonly AppearanceOption[] = SIZE_PRESETS.map((value) => ({
  value,
  label: SIZE_LABEL[value],
}))

export const APPEARANCE_FIELDS: readonly AppearanceField[] = [
  { key: 'homepage_logo_scale', label: 'Logotypstorlek', fallback: 'md', options: sizeOptions },
  { key: 'homepage_scale', label: 'Text under logotyp', fallback: 'md', options: sizeOptions },
  {
    key: 'homepage_logo_style',
    label: 'Logotypens bildstil',
    fallback: 'classic',
    options: [
      { value: 'classic', label: 'Standard' },
      { value: 'monochrome', label: 'Monokrom' },
    ],
  },
  { key: 'about_scale', label: 'Text i Om oss', fallback: 'md', options: sizeOptions },
]
