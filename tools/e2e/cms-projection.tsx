import { render } from 'preact'
import { useState } from 'preact/hooks'
import { emptyDocument } from '../../shared/cms'
import { NativeSiteProvider, useNativeSurface } from '../../src/cms/NativeSurface'
import { snapshotNative, mergeModes } from '../../src/admin/cms/nativePages'
import { HomepageLogo } from '../../src/site/HomepageLogo'
import { HeroLinks } from '../../src/about/HeroLinks'
import { GalleryMarquee } from '../../src/about/GalleryMarquee'
import { palette } from '../../src/booking/bookingStyles'

export async function verifyNativeProjection(): Promise<string[]> {
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  let rows = ['A']
  const checks: string[] = []
  const check = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(message)
    checks.push(message)
  }
  function Fixture() {
    const [count, setCount] = useState(0)
    return useNativeSurface(
      <main>
        <p id="fixture-count">Clicks: {count}</p>
        <p id="fixture-removable">Owner may delete this paragraph</p>
        <div id="fixture-roster">
          {rows.map((id) => (
            <button key={id} type="button" onClick={() => setCount((value) => value + 1)}>
              Barber {id}
            </button>
          ))}
        </div>
        <HeroLinks
          aboutLabel="About"
          cancelLabel="Cancel"
          color="#000000"
          onOpenAbout={() => setCount((value) => value + 1)}
          onOpenCancel={() => setCount((value) => value + 1)}
        />
        <HomepageLogo
          logo={{ path: null, url: '/og-image.png', scale: 'md', style: 'classic' }}
          layout="desktop"
          height={80}
        />
        <GalleryMarquee
          photos={[
            {
              id: '11111111-1111-4111-8111-111111111111',
              url: '/og-image.png',
              alt: 'Original gallery photo',
            },
          ]}
          alt="Gallery photo"
          c={palette(false)}
        />
      </main>,
      'desktop-home',
      'sv',
      'light',
    )
  }
  const presentation = emptyDocument().presentation
  const paint = async (source: boolean): Promise<void> => {
    render(
      <NativeSiteProvider source={source} presentation={presentation}>
        <Fixture />
      </NativeSiteProvider>,
      host,
    )
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  }
  await paint(true)
  const root = host.querySelector('[data-knc-surface="desktop-home"]')
  if (!root) throw new Error('Native fixture did not mount')
  const captured = snapshotNative(root, 'desktop-home')
  const parsed = new DOMParser().parseFromString(captured, 'text/html')
  const logo = parsed.querySelector('img[alt="Blade & Blend Studio"]')
  const gallery = parsed.querySelector('img[alt="Original gallery photo"]')
  const cancel = [...parsed.querySelectorAll('button')].find(
    (node) => node.textContent === 'Cancel',
  )
  if (!logo || !gallery || !cancel) throw new Error('Real component presentation was not captured')
  check(
    Boolean(logo.getAttribute('data-knc-source') && gallery.getAttribute('data-knc-source')),
    'Nested logo and gallery images retain native identities',
  )
  check(
    [...parsed.querySelectorAll('[id]')].every((node) => node.id.length <= 128),
    'Nested entity identities fit the publication ID limit',
  )
  logo.setAttribute('alt', 'Owner logo description')
  gallery.setAttribute('alt', 'Owner gallery description')
  cancel.textContent = 'Owner cancellation action'
  parsed.querySelector('#fixture-removable')?.remove()
  const barber = parsed.querySelector('#fixture-roster button')
  if (barber) barber.textContent = 'Owner barber A'
  const edited = parsed.body.innerHTML
  const html = mergeModes(edited, edited)
  const css = `#${logo.id}{width:73px!important}#${gallery.id}{outline:3px solid rgb(12, 34, 56)!important}`
  presentation.pages.push({
    id: '10000000-0000-4000-8000-000000000001',
    kind: 'page',
    path: '/',
    name: { sv: 'Home', en: 'Home' },
    title: { sv: 'Home', en: 'Home' },
    description: { sv: '', en: '' },
    inMenu: true,
    content: {
      sv: { html, css: { light: css, dark: css } },
      en: { html, css: { light: css, dark: css } },
    },
  })
  rows = ['A', 'B']
  await paint(false)
  check(
    Boolean(host.querySelector('img[alt="Owner logo description"]')),
    'Logo edit projects onto the existing live component',
  )
  check(
    Boolean(host.querySelector('img[alt="Owner gallery description"]')),
    'Gallery edit projects onto the existing live component',
  )
  const liveLogo = host.querySelector('img[alt="Owner logo description"]')
  const liveGallery = host.querySelector('img[alt="Owner gallery description"]')
  check(
    liveLogo && getComputedStyle(liveLogo).width === '73px',
    'Nested logo sizing applies to the live component',
  )
  check(
    liveGallery && getComputedStyle(liveGallery).outlineWidth === '3px',
    'Nested gallery styling applies to the live component',
  )
  check(
    host.querySelector('#fixture-removable') === null,
    'An owner-deleted presentation node stays deleted',
  )
  check(
    host.querySelector('#fixture-roster')?.textContent === 'Owner barber ABarber B',
    'A newly added live barber appears without losing the existing owner edit',
  )
  const action = [...host.querySelectorAll('button')].find(
    (node) => node.textContent === 'Owner cancellation action',
  )
  check(Boolean(action), 'An authored action label survives projection')
  action?.click()
  await new Promise((resolve) => setTimeout(resolve, 20))
  check(
    host.querySelector('#fixture-count')?.textContent === 'Clicks: 1',
    'The edited action retains its original callback and live state',
  )
  const tile = host.querySelector<HTMLElement>('[data-tile-key]')
  tile?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  check(
    tile?.getAttribute('aria-pressed') === 'true',
    'The edited gallery retains keyboard interaction and selection state',
  )
  render(null, host)
  await paint(false)
  check(
    Boolean(
      host.querySelector('img[alt="Owner gallery description"]') &&
      host.querySelector('img[alt="Owner logo description"]'),
    ),
    'Nested edits survive a fresh component mount',
  )
  return checks
}
