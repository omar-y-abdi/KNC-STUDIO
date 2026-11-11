import type { ComponentChildren, JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { Mode } from '../app/shared'
import { buildBookingStyles, palette, sheetBackdropStyle } from '../booking/bookingStyles'
import { useNativeSource } from '../cms/NativeSurface'
import { myBookingsStrings, type Lang } from '../i18n/index'
import { readStoragePreferences } from '../site/storageConsent'
import { Dialog } from '../ui/Dialog'
import { decideHomeScreenGuide, type GuideVisitor } from './eligibility'
import { GlyphIcon } from './glyphs'
import { buildGuideStyles, stepDelay } from './guideStyles'
import { homeScreenGuideRecorded, recordHomeScreenGuide } from './record'
import { guideStrings, type StepText } from './strings'

const BACKDROP_STYLE = sheetBackdropStyle(40)
const TITLE_ID = 'knc-home-screen-title'
/** The file the page's `apple-touch-icon` link names. */
const HOME_SCREEN_ICON = '/apple-touch-icon.png'

// The device keeps a note only with optional storage on; without it, this is the only record.
let shownThisLoad = false
const deviceStorage = (): Storage => window.localStorage

export interface HomeScreenGuideProps {
  readonly mode: Mode
  readonly lang: Lang
  /** As under the icon on the Home Screen. */
  readonly businessName: string
  /** Bookings this device lists, the one just made included. */
  readonly bookings: number
  readonly onClose: () => void
}

function readVisitor(bookings: number): GuideVisitor {
  const display = (mode: string): boolean => window.matchMedia(`(display-mode: ${mode})`).matches
  return {
    userAgent: navigator.userAgent,
    standalone: 'standalone' in navigator && navigator.standalone === true,
    displayStandalone: display('standalone'),
    displayFullscreen: display('fullscreen'),
    bookings,
    shown: shownThisLoad || homeScreenGuideRecorded(deviceStorage),
  }
}

function words(text: StepText, label: JSX.CSSProperties): ComponentChildren {
  return text.map((part, index) =>
    typeof part === 'string' ? (
      part
    ) : (
      <b key={index} style={label}>
        {part.label}
      </b>
    ),
  )
}

/** Renders nothing when the visitor is not eligible, and never in a Studio frame. */
export function HomeScreenGuide(props: HomeScreenGuideProps): JSX.Element | null {
  const source = useNativeSource()
  const [decision] = useState(() => decideHomeScreenGuide(readVisitor(props.bookings)))
  if (source || decision.kind === 'skip') return null
  const dark = props.mode === 'dark'
  const c = palette(dark)
  const s = buildBookingStyles(c, dark, false)
  const g = buildGuideStyles(c)
  const t = guideStrings(props.lang)
  const copy = t.variants[decision.variant]
  const close = (): void => {
    shownThisLoad = true
    recordHomeScreenGuide(deviceStorage, readStoragePreferences())
    props.onClose()
  }
  return (
    <Dialog
      cms={{ surface: `dialog-${TITLE_ID}`, lang: props.lang, mode: props.mode }}
      titleId={TITLE_ID}
      onClose={close}
      onBackdropClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={s.overlayCardStyle}
    >
      <button
        onClick={close}
        style={s.confirmCloseStyle}
        aria-label={myBookingsStrings(props.lang).ariaClose}
      >
        ×
      </button>
      <div style={g.hero}>
        <img src={HOME_SCREEN_ICON} alt="" class="knc-guide-tile" style={g.tile} />
        <div style={g.name}>{props.businessName}</div>
        <div id={TITLE_ID} role="heading" aria-level={2} style={g.title}>
          {t.title}
        </div>
        <div style={g.sub}>{t.sub(props.businessName)}</div>
      </div>
      {/* `role` keeps the list a list for VoiceOver once its markers are off. */}
      <ol role="list" style={g.steps}>
        {copy.steps.map((step, index) => (
          <li
            key={index}
            class="knc-guide-step"
            style={{ ...(index === 0 ? g.step : g.nextStep), animationDelay: stepDelay(index) }}
          >
            <span style={s.badgeStyle}>{index + 1}</span>
            <span style={g.text}>{words(step.text, g.label)}</span>
            {step.glyph === null ? null : (
              <span style={g.glyphTile}>
                <GlyphIcon glyph={step.glyph} style={g.glyph} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {copy.footnote === null ? null : <p style={g.footnote}>{copy.footnote}</p>}
      <div style={g.footer}>
        <button onClick={close} style={s.resetBtnStyle}>
          {t.ok}
        </button>
      </div>
    </Dialog>
  )
}
