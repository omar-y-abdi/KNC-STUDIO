import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { DesktopSite } from '../../app/DesktopSite'
import { MobileSite } from '../../app/MobileSite'
import { chromeIcon, mobBtnBg, mobMuted, shellPalette, type View } from '../../app/shared'
import { appStrings } from '../../i18n'
import { LangSwitch, ThemeSwitch } from '../chrome'
import { readOnlyHomepagePreviewPorts } from '../views/homepageReplicaPorts'
import { defaultSiteChromePort } from '../../site/adapters'
import {
  formatBusinessAddress,
  parseScale,
  parseHomepageLogoPath,
  parseHomepageLogoStyle,
  resolveBusinessSettings,
  resolveSiteText,
} from '../../site/siteChrome'
import { asBarberId } from '../../booking/domain'
import { MyBookingsDialog } from '../../mybookings/MyBookingsDialog'
import { makeMockMyBookingsAdapter } from '../../mybookings/adapters/mockMyBookings'
import { CmsDraftProvider, useCmsStrings, useCmsTheme, useCmsPalette } from '../../cms/context'
import { duplicateCmsNodeIds } from '../../cms/nodeIdentity'
import { SUPABASE_URL } from '../../backend/config'
import {
  validateDocument,
  mediaUrl,
  type CmsDocument,
  type CmsLang,
  type CmsMode,
} from '../../../shared/cms'

export type NativeSurface = 'home' | 'about' | 'booking' | 'myBookings'
export interface PreviewSnapshot {
  document: CmsDocument
  lang: CmsLang
  mode: CmsMode
  surface: NativeSurface
  locked: boolean
  selected: string | null
}
export interface CanvasNode {
  id: string
  tag: string
  label: string
  binding: string | null
  image: boolean
  rect: { x: number; y: number; width: number; height: number }
  parent: string | null
  styles: Record<string, string>
}
const STYLE_NAMES = [
  'width',
  'height',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'color',
  'backgroundColor',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'display',
  'gap',
  'textAlign',
  'opacity',
]
function describe(element: HTMLElement): CanvasNode {
  const box = element.getBoundingClientRect(),
    computed = getComputedStyle(element)
  return {
    id: element.dataset['cmsNode'] ?? '',
    tag: element.tagName.toLowerCase(),
    label: (
      element.getAttribute('aria-label') ||
      element.textContent ||
      element.getAttribute('alt') ||
      element.tagName
    )
      .trim()
      .slice(0, 70),
    binding: element.dataset['cmsCopy'] ?? null,
    image: element.tagName === 'IMG',
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    parent:
      element.parentElement?.closest<HTMLElement>('[data-cms-node]')?.dataset['cmsNode'] ?? null,
    styles: Object.fromEntries(
      STYLE_NAMES.map((name) => [
        name,
        computed.getPropertyValue(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
      ]),
    ),
  }
}
function NativeSite({
  snapshot,
  send,
}: {
  snapshot: PreviewSnapshot
  send: (type: string, payload?: unknown) => void
}): JSX.Element {
  const { document: draft, lang, mode } = snapshot
  useCmsTheme(mode)
  const [surface, setSurface] = useState(snapshot.surface)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:768px)').matches)
  const [liveCancellationPolicyHours, setLiveCancellationPolicyHours] = useState<number | null>(
    null,
  )
  const dark = mode === 'dark',
    c = useCmsPalette(shellPalette(dark), mode)
  useEffect(() => {
    let active = true
    void defaultSiteChromePort
      .load(lang)
      .then((chrome) => {
        if (active) setLiveCancellationPolicyHours(chrome?.business.cancellationPolicyHours ?? null)
      })
      .catch(() => {
        if (active) setLiveCancellationPolicyHours(null)
      })
    return () => {
      active = false
    }
  }, [lang])
  const draftBusiness = resolveBusinessSettings(new Map(Object.entries(draft.settings)))
  const business =
    liveCancellationPolicyHours === null
      ? draftBusiness
      : { ...draftBusiness, cancellationPolicyHours: liveCancellationPolicyHours }
  const text = Object.fromEntries(
    Object.entries(draft.site).map(([key, value]) => [key, value[lang] ?? '']),
  )
  const resolved = resolveSiteText(text, lang, business.cancellationPolicyHours, business.name)
  const tx = useCmsStrings('app', lang, {
    ...appStrings(lang),
    kicker: resolved.kicker,
    hours: resolved.hours,
    addr: formatBusinessAddress(business),
  })
  const path = parseHomepageLogoPath(draft.settings['homepage_logo_path'])
  const logo = {
    path,
    url: path && SUPABASE_URL ? mediaUrl({ bucket: 'gallery', path }, SUPABASE_URL) : null,
    scale: parseScale(draft.settings['homepage_logo_scale']),
    style: parseHomepageLogoStyle(draft.settings['homepage_logo_style']),
  }
  const ports = useMemo(() => {
    const read = readOnlyHomepagePreviewPorts()
    return {
      ...read,
      barbers: {
        listActive: async () => {
          const live = await read.barbers.listActive()
          const draftById = new Map(draft.barbers.map((barber) => [barber.id, barber]))
          return live
            .map((entry) => {
              const barber = draftById.get(String(entry.barber.id))
              if (!barber) return entry
              return {
                ...entry,
                barber: { id: asBarberId(barber.id), name: barber.name, ig: barber.ig },
                copy: {
                  roleSv: barber.role_sv,
                  roleEn: barber.role_en,
                  bioSv: barber.bio_sv,
                  bioEn: barber.bio_en,
                },
                photoUrl:
                  draft.photos[barber.id] && SUPABASE_URL
                    ? mediaUrl(
                        { bucket: 'barber-photos', path: draft.photos[barber.id] ?? '' },
                        SUPABASE_URL,
                      )
                    : null,
              }
            })
            .sort(
              (a, b) =>
                (draftById.get(String(a.barber.id))?.sort_order ?? 0) -
                (draftById.get(String(b.barber.id))?.sort_order ?? 0),
            )
        },
      },
      aboutContent: {
        overlay: (locale: CmsLang) =>
          Promise.resolve(
            Object.fromEntries(
              Object.entries(draft.about).map(([key, value]) => [key, value[locale] ?? '']),
            ),
          ),
      },
      gallery: {
        list: (kind: 'salon' | 'cuts') =>
          Promise.resolve(
            draft.gallery
              .filter((image) => image.kind === kind)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((image) => ({
                id: image.id,
                url: mediaUrl(
                  { bucket: 'gallery', path: image.storage_path },
                  SUPABASE_URL ?? 'https://unconfigured.invalid',
                ),
                alt: image.alt,
              })),
          ),
      },
    }
  }, [draft.barbers, draft.photos, draft.about, draft.gallery])
  const customerPort = useMemo(() => makeMockMyBookingsAdapter(), [])
  useEffect(() => {
    setSurface(snapshot.surface)
  }, [snapshot.surface])
  useEffect(() => {
    const query = matchMedia('(max-width:768px)'),
      listener = (): void => setMobile(query.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
    document.body.style.background = c.bg
  }, [lang, c.bg])
  useEffect(() => {
    if (surface !== 'about') return
    const id = requestAnimationFrame(() =>
      document.getElementById('om-oss')?.scrollIntoView({ block: 'start', behavior: 'instant' }),
    )
    return () => cancelAnimationFrame(id)
  }, [surface, mobile])
  const view: View = surface === 'booking' ? 'booking' : 'home'
  const themeToggle = (
    <ThemeSwitch
      dark={dark}
      onToggle={() => send('mode', dark ? 'light' : 'dark')}
      label="Byt tema"
    />
  )
  const langToggle = <LangSwitch lang={lang} setLang={(value) => send('lang', value)} dark={dark} />
  const common = {
    mode,
    lang,
    dark,
    c,
    tx,
    view,
    business,
    chromeIconStyle: chromeIcon(dark),
    themeToggle,
    langToggle,
    openCancel: () => setSurface('myBookings'),
    openMyBookings: () => setSurface('myBookings'),
    homepageScale: parseScale(draft.settings['homepage_scale']),
    homepageLogo: logo,
    aboutScale: parseScale(draft.settings['about_scale']),
    bookingPopupText: resolved,
    scrollToAbout: () => setSurface('about'),
    previewPorts: ports,
  }
  return (
    <>
      <style>
        {
          '[data-cms-picked]{outline:2px solid #557cfa!important;outline-offset:2px!important}[data-cms-hover]:not([data-cms-picked]){outline:1px solid #8da7ff!important;outline-offset:1px!important}html{scroll-behavior:auto!important}'
        }
      </style>
      {mobile ? (
        <MobileSite
          {...common}
          mobMutedColor={mobMuted(dark)}
          mobBtnBgColor={mobBtnBg(dark)}
          openMobBooking={() => setSurface('booking')}
          scrollMobToHero={() => setSurface('home')}
        />
      ) : (
        <DesktopSite
          {...common}
          toggleDeskBooking={() =>
            setSurface((value) => (value === 'booking' ? 'home' : 'booking'))
          }
          findUsStyle={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 14px',
            borderRadius: '999px',
            border: `1px solid ${c.line}`,
            color: c.text,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        />
      )}
      {surface === 'myBookings' && (
        <MyBookingsDialog
          mode={mode}
          lang={lang}
          onClose={() => setSurface('home')}
          port={customerPort}
        />
      )}
    </>
  )
}
export default function CmsPreview(): JSX.Element {
  const channel = new URLSearchParams(location.search).get('channel') ?? ''
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null)
  const current = useRef(snapshot)
  current.current = snapshot
  const send = (type: string, payload?: unknown): void => {
    if (window.parent !== window && /^[0-9a-f-]{36}$/.test(channel))
      window.parent.postMessage(
        { source: 'knc-cms-preview', channel, type, payload },
        location.origin,
      )
  }
  useEffect(() => {
    if (window.parent === window || !/^[0-9a-f-]{36}$/.test(channel)) return
    const receive = (event: MessageEvent): void => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        !event.data ||
        typeof event.data !== 'object'
      )
        return
      const data = event.data as Record<string, unknown>
      if (data['source'] !== 'knc-cms-studio' || data['channel'] !== channel) return
      if (data['type'] === 'ping') {
        send('ready')
        return
      }
      if (data['type'] === 'select' && typeof data['id'] === 'string') {
        const element = [...document.querySelectorAll<HTMLElement>('[data-cms-node]')].find(
          (node) => node.dataset['cmsNode'] === data['id'],
        )
        if (element) {
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          send('select', describe(element))
        }
        return
      }
      if (data['type'] !== 'snapshot' || !data['payload'] || typeof data['payload'] !== 'object')
        return
      const value = data['payload'] as Record<string, unknown>
      try {
        validateDocument(value['document'])
        if (
          !['sv', 'en'].includes(String(value['lang'])) ||
          !['light', 'dark'].includes(String(value['mode'])) ||
          !['home', 'about', 'booking', 'myBookings'].includes(String(value['surface'])) ||
          typeof value['locked'] !== 'boolean' ||
          (value['selected'] !== null && typeof value['selected'] !== 'string')
        )
          return
        setSnapshot(value as unknown as PreviewSnapshot)
      } catch {
        send('error', 'Förhandsvisningen avvisade ett ogiltigt dokument.')
      }
    }
    const click = (event: MouseEvent): void => {
      if (current.current?.locked) {
        if ((event.target as Element | null)?.closest('a[href]')) event.preventDefault()
        return
      }
      const element = (event.target as Element | null)?.closest<HTMLElement>('[data-cms-node]')
      event.preventDefault()
      event.stopImmediatePropagation()
      if (element) send(event.type === 'dblclick' ? 'edit' : 'select', describe(element))
    }
    const move = (event: MouseEvent): void => {
      document.querySelector('[data-cms-hover]')?.removeAttribute('data-cms-hover')
      if (current.current?.locked) return
      ;(event.target as Element | null)
        ?.closest('[data-cms-node]')
        ?.setAttribute('data-cms-hover', '')
    }
    const key = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        send('shortcut', { key: event.key.toLowerCase(), shift: event.shiftKey })
      }
    }
    const inventory = (): void => {
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-cms-node]')].filter(
        (node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
      )
      const duplicates = duplicateCmsNodeIds(nodes.map((node) => node.dataset['cmsNode'] ?? ''))
      if (duplicates.length > 0) {
        send(
          'error',
          `Förhandsvisningen hittade dubbla CMS-nod-ID:n: ${duplicates.slice(0, 5).join(', ')}`,
        )
        return
      }
      send('nodes', nodes.map(describe))
      document.querySelector('[data-cms-picked]')?.removeAttribute('data-cms-picked')
      const selected = nodes.find((node) => node.dataset['cmsNode'] === current.current?.selected)
      if (selected) {
        selected.setAttribute('data-cms-picked', '')
        send('bounds', describe(selected))
      }
    }
    let frame: number | null = null
    const schedule = (): void => {
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null
          inventory()
        })
    }
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === 'childList' ||
            (record.attributeName !== 'data-cms-picked' &&
              record.attributeName !== 'data-cms-hover'),
        )
      )
        schedule()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    window.addEventListener('message', receive)
    document.addEventListener('click', click, true)
    document.addEventListener('dblclick', click, true)
    document.addEventListener('mousemove', move, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    send('ready')
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('message', receive)
      document.removeEventListener('click', click, true)
      document.removeEventListener('dblclick', click, true)
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [channel])
  return snapshot ? (
    <CmsDraftProvider document={snapshot.document} lang={snapshot.lang}>
      <NativeSite snapshot={snapshot} send={send} />
    </CmsDraftProvider>
  ) : (
    <p role="status">Väntar på redigeringsdokumentet…</p>
  )
}
