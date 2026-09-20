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
  let hours = 'Original hours'
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
        <span id="fixture-live-hours">
          <img src="/icons/clock.svg" alt="" />
          {hours}
        </span>
        <span id="fixture-owned-hours">
          <img src="/icons/clock.svg" alt="" />
          {hours}
        </span>
        <span id="fixture-deleted-icon">
          <img src="/icons/clock.svg" alt="" />
          {hours}
        </span>
        <span id="fixture-inserted-child">
          <img src="/icons/clock.svg" alt="" />
          {hours}
        </span>
        <span id="fixture-reordered-icons">
          <img src="/icons/clock.svg" alt="" />
          {hours}
        </span>
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
  const ownedHours = parsed.querySelector('#fixture-owned-hours')?.lastChild
  if (ownedHours) ownedHours.textContent = 'Owner hours'
  parsed.querySelector('#fixture-deleted-icon img')?.remove()
  const inserted = parsed.createElement('b')
  inserted.textContent = 'Inserted'
  const insertedParent = parsed.querySelector('#fixture-inserted-child')
  if (insertedParent) insertedParent.insertBefore(inserted, insertedParent.lastChild)
  const reordered = parsed.querySelector('#fixture-reordered-icons')
  if (reordered?.firstChild) reordered.appendChild(reordered.firstChild)
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
  hours = 'Updated live hours'
  await paint(false)
  check(
    host.querySelector('#fixture-live-hours')?.textContent === hours,
    'Unedited mixed native text follows current runtime values',
  )
  check(
    host.querySelector('#fixture-owned-hours')?.textContent === 'Owner hours',
    'Owner-edited mixed text survives changed runtime values',
  )
  check(
    host.querySelectorAll('#fixture-live-hours img, #fixture-owned-hours img').length === 2,
    'Mixed text reconciliation retains native icons',
  )
  check(
    !host.querySelector('#fixture-deleted-icon img') &&
      host.querySelector('#fixture-deleted-icon')?.textContent === 'Original hours',
    'Owner-deleted icons stay deleted without losing unchanged caption text',
  )
  check(
    host.querySelector('#fixture-inserted-child')?.textContent === 'InsertedOriginal hours',
    'An owner-inserted child does not erase adjacent unchanged text',
  )
  check(
    host.querySelector('#fixture-reordered-icons')?.textContent === 'Original hours' &&
      host.querySelector('#fixture-reordered-icons')?.firstChild?.nodeType === 3 &&
      host.querySelector('#fixture-reordered-icons img')?.getAttribute('src') ===
        '/icons/clock.svg',
    'Owner-reordered icons retain their order and unchanged caption text',
  )
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
