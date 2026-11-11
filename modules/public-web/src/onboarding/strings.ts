// Here and not in i18n/: those tables load with the first paint, the guide only with its chunk.

import type { Lang } from '../i18n/index'
import type { GuideVariant } from './eligibility'
import type { Glyph } from './glyphs'

/** A step's words; a `label` is Apple's own name for a control, set heavier. */
export type StepText = readonly (string | { readonly label: string })[]

export interface GuideStep {
  readonly text: StepText
  readonly glyph: Glyph | null
}

export interface GuideCopy {
  readonly steps: readonly GuideStep[]
  readonly footnote: string | null
}

export interface GuideStrings {
  readonly title: string
  readonly sub: (business: string) => string
  readonly ok: string
  readonly variants: Readonly<Record<GuideVariant, GuideCopy>>
}

const SV_SHARE: GuideStep = { text: ['Välj ', { label: 'Dela' }], glyph: 'share' }
const SV_ADD: GuideStep = {
  text: ['Rulla ned och välj ', { label: 'Lägg till på hemskärmen' }],
  glyph: 'add-to-home-screen',
}
const SV_WEB_APP: GuideStep = {
  text: ['Låt ', { label: 'Öppna som webbapp' }, ' vara på och tryck på ', { label: 'Lägg till' }],
  glyph: null,
}
const SV_FOOTNOTE = 'Syns delningssymbolen redan längst ned i Safari? Börja på steg 2.'

const SV: GuideStrings = {
  title: 'Lägg till på hemskärmen',
  sub: (business) => `Då har du ${business} ett tryck bort och bokar nästa tid snabbare.`,
  ok: 'Okej',
  variants: {
    A: {
      steps: [
        { text: ['Tryck på symbolen till vänster i adressfältet'], glyph: 'page-menu' },
        SV_SHARE,
        SV_ADD,
        SV_WEB_APP,
      ],
      footnote: SV_FOOTNOTE,
    },
    B: {
      steps: [
        { text: ['Tryck på knappen med tre punkter till höger om adressfältet'], glyph: 'more' },
        SV_SHARE,
        SV_ADD,
        SV_WEB_APP,
      ],
      footnote: SV_FOOTNOTE,
    },
    C: {
      steps: [
        { text: ['Tryck på ', { label: 'Dela' }, ' längst ned i Safari'], glyph: 'share' },
        SV_ADD,
        { text: ['Tryck på ', { label: 'Lägg till' }], glyph: null },
      ],
      footnote: null,
    },
  },
}

const EN_SHARE: GuideStep = { text: ['Choose ', { label: 'Share' }], glyph: 'share' }
const EN_ADD: GuideStep = {
  text: ['Scroll down and choose ', { label: 'Add to Home Screen' }],
  glyph: 'add-to-home-screen',
}
const EN_WEB_APP: GuideStep = {
  text: ['Leave ', { label: 'Open as Web App' }, ' on and tap ', { label: 'Add' }],
  glyph: null,
}
const EN_FOOTNOTE = 'Is the Share icon already at the bottom of Safari? Start at step 2.'

const EN: GuideStrings = {
  title: 'Add to your Home Screen',
  sub: (business) => `Keep ${business} one tap away and book your next appointment faster.`,
  ok: 'Got it',
  variants: {
    A: {
      steps: [
        { text: ['Tap the icon at the left of the address field'], glyph: 'page-menu' },
        EN_SHARE,
        EN_ADD,
        EN_WEB_APP,
      ],
      footnote: EN_FOOTNOTE,
    },
    B: {
      steps: [
        {
          text: ['Tap the button with three dots to the right of the address field'],
          glyph: 'more',
        },
        EN_SHARE,
        EN_ADD,
        EN_WEB_APP,
      ],
      footnote: EN_FOOTNOTE,
    },
    C: {
      steps: [
        { text: ['Tap ', { label: 'Share' }, ' at the bottom of Safari'], glyph: 'share' },
        EN_ADD,
        { text: ['Tap ', { label: 'Add' }], glyph: null },
      ],
      footnote: null,
    },
  },
}

export function guideStrings(lang: Lang): GuideStrings {
  return lang === 'en' ? EN : SV
}
