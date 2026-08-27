// Owner CMS preview: render the production desktop surface with draft chrome, never a hand-built
// approximation. Its own local navigation lets an editor inspect the hero, booking fold, and About
// content without changing the public page.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { DesktopSite } from '../../app/DesktopSite'
import { chromeIcon, shellPalette, type View } from '../../app/shared'
import { LangSwitch, ThemeSwitch } from '../chrome'
import type { AdminStylesBundle } from './viewTypes'
import { readOnlyHomepagePreviewPorts } from './homepageReplicaPorts'
import { appStrings, type Lang } from '../../i18n/index'
import {
  formatBusinessAddress,
  resolveBusinessSettings,
  resolveSiteText,
  type HomepageLogo,
  type SiteText,
  type SizePreset,
} from '../../site/siteChrome'

const previewPorts = readOnlyHomepagePreviewPorts()

export interface HomepageReplicaPreviewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly settings: ReadonlyMap<string, string>
  readonly textByLang: Readonly<Record<Lang, SiteText>>
  readonly homepageScale: SizePreset
  readonly logo: HomepageLogo
  readonly aboutScale: SizePreset
  readonly s: AdminStylesBundle
}

type PreviewSurface = View | 'about'

export function HomepageReplicaPreview(props: HomepageReplicaPreviewProps): JSX.Element {
  const [dark, setDark] = useState(props.dark)
  const [lang, setLang] = useState<Lang>(props.lang)
  const [surface, setSurface] = useState<PreviewSurface>('home')
  const scrollRootRef = useRef<HTMLDivElement>(null)
  useEffect(() => setDark(props.dark), [props.dark])
  useEffect(() => setLang(props.lang), [props.lang])
  useEffect(() => {
    const scrollRoot = scrollRootRef.current
    if (scrollRoot === null) return
    const frame = window.requestAnimationFrame(() => {
      const target =
        surface === 'booking'
          ? scrollRoot.querySelector<HTMLElement>('[data-testid="fold-booking"]')
          : surface === 'about'
            ? scrollRoot.querySelector<HTMLElement>('#om-oss')
            : null
      if (target === null) {
        scrollRoot.scrollTo({ top: 0 })
        return
      }
      const hostTop = scrollRoot.getBoundingClientRect().top
      const targetTop = target.getBoundingClientRect().top
      scrollRoot.scrollTo({ top: scrollRoot.scrollTop + targetTop - hostTop - 61 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [surface])

  const view: View = surface === 'booking' ? 'booking' : 'home'

  const c = shellPalette(dark)
  const business = resolveBusinessSettings(props.settings)
  const resolvedText = resolveSiteText(
    props.textByLang[lang],
    lang,
    business.cancellationPolicyHours,
    business.name,
  )
  const tx = {
    ...appStrings(lang),
    kicker: resolvedText.kicker,
    hours: resolvedText.hours,
    addr: formatBusinessAddress(business),
  }
  const findUsStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 14px',
    borderRadius: '999px',
    border: `.5px solid ${dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.16)'}`,
    color: c.text,
    textDecoration: 'none',
    fontWeight: 600,
    opacity: 0.92,
  }

  return (
    <div
      data-testid="homepage-replica-preview"
      aria-label={lang === 'sv' ? 'Skrivskyddad startsidereplika' : 'Read-only homepage replica'}
    >
      <div
        role="toolbar"
        aria-label={lang === 'sv' ? 'Förhandsvisningskontroller' : 'Preview controls'}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}
      >
        {(['home', 'booking', 'about'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={surface === entry}
            onClick={() => setSurface(entry)}
            style={surface === entry ? props.s.primaryBtn : props.s.ghostBtn}
          >
            {entry === 'home'
              ? lang === 'sv'
                ? 'Startsida'
                : 'Home'
              : entry === 'booking'
                ? lang === 'sv'
                  ? 'Bokning'
                  : 'Booking'
                : lang === 'sv'
                  ? 'Om oss'
                  : 'About'}
          </button>
        ))}
        <LangSwitch lang={lang} setLang={setLang} dark={dark} />
        <ThemeSwitch
          dark={dark}
          onToggle={() => setDark((value) => !value)}
          label={lang === 'sv' ? 'Byt förhandsvisningstema' : 'Toggle preview theme'}
        />
      </div>
      <div
        ref={scrollRootRef}
        data-testid="homepage-replica-scroll"
        style={{
          height: '580px',
          overflow: 'auto',
          border: dark ? '1px solid rgba(255,255,255,.16)' : '1px solid rgba(0,0,0,.12)',
          borderRadius: '13px',
        }}
      >
        <div aria-hidden="true" inert style={{ pointerEvents: 'none' }}>
          <DesktopSite
            mode={dark ? 'dark' : 'light'}
            lang={lang}
            dark={dark}
            c={c}
            business={business}
            chromeIconStyle={chromeIcon(dark)}
            themeToggle={<ThemeSwitch dark={dark} onToggle={() => undefined} label="Theme" />}
            langToggle={<LangSwitch lang={lang} setLang={() => undefined} dark={dark} />}
            tx={tx}
            view={view}
            toggleDeskBooking={() =>
              setSurface((value) => (value === 'booking' ? 'home' : 'booking'))
            }
            scrollToAbout={() => setSurface('about')}
            findUsStyle={findUsStyle}
            openCancel={() => undefined}
            openMyBookings={() => undefined}
            homepageScale={props.homepageScale}
            homepageLogo={props.logo}
            aboutScale={props.aboutScale}
            bookingPopupText={resolvedText}
            previewPorts={previewPorts}
            scrollRootRef={scrollRootRef}
          />
        </div>
      </div>
    </div>
  )
}
