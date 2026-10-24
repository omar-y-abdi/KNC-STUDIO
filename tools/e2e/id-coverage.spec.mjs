// LIB-14 id coverage. Every data-knc-source and data-knc-slot id in the committed rev-56
// presentation must resolve in the nativeTree output of the public surfaces (DesktopSite,
// MobileSite, AboutSection, GalleryMarquee, BookingFlow, MyBookingsDialog, Dialog): a source id to
// a live source with the same tag, a slot id to a live slot or source. Otherwise projectNativeTree
// silently drops or ignores that stored edit, and a missing slot makes its component vanish. The
// rules are in id-coverage.mjs.
//
// The live tree is read exactly where the CMS captured the stored one: the source renderer at
// /cms-public/source, driven by the same `knc-source-context` messages and device sizes as
// readCorePageSource (src/admin/cms/nativePages.ts). Its data comes from the stored entities in
// public-fixtures.mjs; the clock is fixed in the captured month, because the stored booking
// calendar is September 2026 and its cells depend on the month.

import { test, expect } from './fixtures.mjs'
import { installStoredBackend, storedPresentationResponse } from './public-fixtures.mjs'
import { coverageProblems, describeProblem } from './id-coverage.mjs'
import { publicOrigin } from './origins.mjs'

const base = publicOrigin
const CAPTURE_TIME = new Date('2026-09-14T08:00:00Z')
const DEVICES = {
  Desktop: { width: 1440, height: 900 },
  Mobile: { width: 390, height: 844 },
}
const DESKTOP_SCENES = [
  'home',
  'booking',
  'my-bookings',
  'booking-options',
  'booking-details',
  'booking-confirmation',
  'my-bookings-list',
]
// readCorePageSource renders no booking stages or bookings list on Mobile.
const MOBILE_SCENES = ['home', 'booking', 'my-bookings']
const MAX_LISTED = 40
// Orphans that HEAD already has against rev 56: the language switch was rebuilt after the capture,
// from a <div> holding SV and EN <button>s into one <button> holding two <span>s, so stored edits on
// it are lost today (the live switch renders, so the homepage itself is unchanged). A ratchet: these
// 12 ids must be orphaned in exactly the four captures of their surface (sv/en x light/dark), 48
// occurrences in all. Any other orphan fails, and so does a fix until it deletes the entries here.
const KNOWN_ORPHANS = [
  ['desktop-home', 'knc-desktop-home-0-i0-i1-i2'],
  ['desktop-booking', 'knc-desktop-booking-0-i0-i1-i2'],
  ['mobile-home', 'knc-mobile-home-0-i0-i0-i1-i1-i0'],
  ['mobile-booking', 'knc-mobile-booking-0-i0-i0-i1-i1-i0'],
].flatMap(([surface, toggle]) => [
  { surface, kind: 'retagged', id: toggle, stored: 'div', live: 'button' },
  { surface, kind: 'retagged', id: `${toggle}-i0`, stored: 'button', live: 'span' },
  { surface, kind: 'retagged', id: `${toggle}-i1`, stored: 'button', live: 'span' },
])
const LANG_MODES = ['sv', 'en'].flatMap((lang) => ['light', 'dark'].map((mode) => ({ lang, mode })))
const sameOrphan = (a, b) =>
  a.surface === b.surface &&
  a.kind === b.kind &&
  a.id === b.id &&
  a.stored === b.stored &&
  a.live === b.live
const orphanKey = ({ lang, mode }, { surface, kind, id, stored, live }) =>
  `${lang} ${mode} ${surface}: ${kind} ${id} (stored <${stored}>, live <${live}>)`
const EXPECTED_KNOWN = LANG_MODES.flatMap((capture) =>
  KNOWN_ORPHANS.map((orphan) => orphanKey(capture, orphan)),
).sort()

/** Stored page and surface that each rendered scene is checked against. */
function surfacesOf(device, scene) {
  const prefix = device.toLowerCase()
  if (scene === 'home')
    return [
      ['/', `${prefix}-home`],
      ['/about', 'about'],
    ]
  if (scene === 'booking') return [['/booking', `${prefix}-booking`]]
  if (scene.startsWith('booking-')) return [['/booking', scene]]
  return [['/my-bookings', scene]]
}

function captures() {
  return LANG_MODES.flatMap(({ lang, mode }) =>
    Object.entries({ Desktop: DESKTOP_SCENES, Mobile: MOBILE_SCENES }).flatMap(([device, scenes]) =>
      scenes.map((scene) => ({ lang, mode, device, scene })),
    ),
  )
}

async function renderSource(page, capture, id) {
  await page.setViewportSize(DEVICES[capture.device])
  await page.evaluate((message) => globalThis.postMessage(message, globalThis.location.origin), {
    type: 'knc-source-context',
    id,
    ...capture,
  })
  await page.waitForFunction((expected) => {
    const state = globalThis.document.documentElement.dataset
    if (state.kncSourceError === expected)
      throw new Error(`Source render failed: ${state.kncSourceFailure}`)
    return state.kncSourceReady === expected
  }, id)
}

/**
 * Stored and live source and slot nodes of one surface; marquee tiles become shapes (see
 * id-coverage.mjs).
 */
function readSurface({ html, surface }) {
  const live = globalThis.document.querySelector(`[data-knc-surface="${surface}"]`)
  const stored = new globalThis.DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector(`[data-knc-surface="${surface}"]`)
  if (live === null || stored === null)
    return { error: `surface ${surface} is ${live === null ? 'not rendered' : 'not stored'}` }
  const trackIds = new Set(
    [...live.querySelectorAll('[data-testid="marquee-track"][data-knc-source]')].map((node) =>
      node.getAttribute('data-knc-source'),
    ),
  )
  const shape = (node) => `${node.localName}(${[...node.children].map(shape).join(',')})`
  // As projectNativeTree reads an element's id: the source id, else the slot id.
  const nodeOf = (node) => {
    const source = node.getAttribute('data-knc-source')
    if (source !== null) return { id: source, tag: node.localName, kind: 'source' }
    const slot = node.getAttribute('data-knc-slot')
    return slot === null ? null : { id: slot, tag: node.localName, kind: 'slot' }
  }
  const read = (root) => {
    const tree = { nodes: [], tracks: {} }
    const visit = (node, inTrack) => {
      const found = nodeOf(node)
      const track = found !== null && found.kind === 'source' && trackIds.has(found.id)
      if (found !== null && !inTrack) tree.nodes.push(found)
      if (track) tree.tracks[found.id] = [...node.children].map(shape)
      for (const child of node.children) visit(child, inTrack || track)
    }
    visit(root, false)
    return tree
  }
  return { stored: read(stored), live: read(live) }
}

test.use({ viewport: DEVICES.Desktop })

test('every stored data-knc-source id exists live with its tag', async ({ page, context }) => {
  test.setTimeout(300_000)
  const { presentation } = storedPresentationResponse()
  const pages = new Map(presentation.pages.map((stored) => [stored.path, stored]))
  await installStoredBackend(context)
  await page.clock.setFixedTime(CAPTURE_TIME)
  await page.goto(`${base}/cms-public/source`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => globalThis.document.documentElement.dataset.kncSourceListening === '1',
  )

  const problems = []
  const seenKnown = []
  let checkedIds = 0
  let checkedSlots = 0
  let checkedTracks = 0
  for (const [index, capture] of captures().entries()) {
    await renderSource(page, capture, `lib14-${index}`)
    for (const [path, surface] of surfacesOf(capture.device, capture.scene)) {
      const where = `${surface} (${capture.device} ${capture.scene} ${capture.lang} ${capture.mode})`
      const html = pages.get(path).content[capture.lang].html
      const read = await page.evaluate(readSurface, { html, surface })
      if (read.error !== undefined) {
        problems.push(`${where}: ${read.error}`)
        continue
      }
      checkedIds += read.stored.nodes.length
      checkedSlots += read.stored.nodes.filter(({ kind }) => kind === 'slot').length
      checkedTracks += Object.keys(read.stored.tracks).length
      for (const problem of coverageProblems(read.stored, read.live)) {
        const orphan = { surface, ...problem }
        if (KNOWN_ORPHANS.some((known) => sameOrphan(known, orphan)))
          seenKnown.push(orphanKey(capture, orphan))
        else problems.push(describeProblem(where, problem))
      }
    }
  }

  test.info().annotations.push({
    type: 'id coverage',
    description: `${checkedIds} stored ids (${checkedSlots} of them slots) and ${checkedTracks} marquee tracks checked; ${problems.length} new orphans; ${seenKnown.length} known orphan occurrences`,
  })
  expect(checkedIds, 'the stored presentation has source ids to check').toBeGreaterThan(0)
  expect(checkedSlots, 'the stored presentation has slot ids to check').toBeGreaterThan(0)
  expect(
    problems,
    [
      `${problems.length} stored edit(s) would be lost:`,
      ...problems.slice(0, MAX_LISTED),
      ...(problems.length > MAX_LISTED ? [`... and ${problems.length - MAX_LISTED} more`] : []),
    ].join('\n'),
  ).toEqual([])
  expect(
    seenKnown.sort(),
    'the language-switch orphans must occur exactly once per language and mode; after a fix, delete them from KNOWN_ORPHANS',
  ).toEqual(EXPECTED_KNOWN)
})
