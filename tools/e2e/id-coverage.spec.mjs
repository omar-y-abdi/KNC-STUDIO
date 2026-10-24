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
import { coverageProblems, describeWhere, ratchetVerdict } from './id-coverage.mjs'
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
// readCorePageSource renders no booking stages or bookings list on Mobile. It renders the Mobile
// About (in 'home') and 'my-bookings' but stores neither: the stored /about and /my-bookings pages
// are the Desktop captures, so those two Mobile renders are checked against them.
const MOBILE_SCENES = ['home', 'booking', 'my-bookings']
const MAX_LISTED = 40
const LANG_MODES = ['sv', 'en'].flatMap((lang) => ['light', 'dark'].map((mode) => ({ lang, mode })))
const capturesOf = (device, scene) =>
  LANG_MODES.map(({ lang, mode }) => ({ lang, mode, device, scene }))
// Orphans that HEAD already has against rev 56. The language switch was rebuilt after the capture,
// from a <div> holding SV and EN <button>s into one <button> holding two <span>s, so stored edits on
// it are lost today (the live switch renders, so the homepage itself is unchanged).
const LANGUAGE_SWITCH_ORPHANS = [
  ['desktop-home', 'knc-desktop-home-0-i0-i1-i2', 'Desktop', 'home'],
  ['desktop-booking', 'knc-desktop-booking-0-i0-i1-i2', 'Desktop', 'booking'],
  ['mobile-home', 'knc-mobile-home-0-i0-i0-i1-i1-i0', 'Mobile', 'home'],
  ['mobile-booking', 'knc-mobile-booking-0-i0-i0-i1-i1-i0', 'Mobile', 'booking'],
].flatMap(([surface, toggle, device, scene]) => {
  const captures = capturesOf(device, scene)
  return [
    { id: toggle, stored: 'div', live: 'button' },
    { id: `${toggle}-i0`, stored: 'button', live: 'span' },
    { id: `${toggle}-i1`, stored: 'button', live: 'span' },
  ].map((retagged) => ({ orphan: { surface, kind: 'retagged', ...retagged }, captures }))
})
// The Turnstile wrapper of the my-bookings lookup form. MyBookingsDialog.tsx:122 sets
// `challengeRequired = turnstileConfigured && previewPorts === undefined` and /cms-public/source
// passes previewPorts, so no capture carries the slot; the real /my-bookings renders it (probed).
const TURNSTILE_ORPHAN = {
  orphan: {
    surface: 'my-bookings',
    kind: 'missing-slot',
    id: 'knc-my-bookings-0-i0-i1-i3-i3',
    stored: 'div',
    live: null,
  },
  captures: ['Desktop', 'Mobile'].flatMap((device) => capturesOf(device, 'my-bookings')),
}
// A ratchet, exact to the capture: each orphan must occur in the captures listed with it (device,
// scene, language, mode), once each, and nowhere else: the 12 language-switch ids in 4 captures
// each (48), the Turnstile slot in 8 (56 in all). Any other orphan fails, a listed one in another
// capture too, and so does a fix until it deletes the entries here.
const KNOWN_ORPHANS = [...LANGUAGE_SWITCH_ORPHANS, TURNSTILE_ORPHAN]
const KNOWN_OCCURRENCES = KNOWN_ORPHANS.reduce((total, { captures }) => total + captures.length, 0)

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
  // As projectNativeTree reads an element: the slot attribute decides how it resolves, the source
  // id (else the slot id) is the identity that duplicates are counted by.
  const nodeOf = (node) => {
    const source = node.getAttribute('data-knc-source')
    const slot = node.getAttribute('data-knc-slot')
    if (slot !== null)
      return {
        id: slot,
        tag: node.localName,
        kind: 'slot',
        ...(source === null ? {} : { identity: source }),
      }
    return source === null ? null : { id: source, tag: node.localName, kind: 'source' }
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

  const unreadable = []
  const found = []
  let checkedIds = 0
  let checkedSlots = 0
  let checkedTracks = 0
  for (const [index, capture] of captures().entries()) {
    await renderSource(page, capture, `lib14-${index}`)
    for (const [path, surface] of surfacesOf(capture.device, capture.scene)) {
      const html = pages.get(path).content[capture.lang].html
      const read = await page.evaluate(readSurface, { html, surface })
      if (read.error !== undefined) {
        unreadable.push(`${describeWhere(capture, surface)}: ${read.error}`)
        continue
      }
      checkedIds += read.stored.nodes.length
      checkedSlots += read.stored.nodes.filter(({ kind }) => kind === 'slot').length
      checkedTracks += Object.keys(read.stored.tracks).length
      for (const problem of coverageProblems(read.stored, read.live))
        found.push({ capture, orphan: { surface, ...problem } })
    }
  }

  const { unexpected, absent } = ratchetVerdict(found, KNOWN_ORPHANS)
  const problems = [...unreadable, ...unexpected]
  test.info().annotations.push({
    type: 'id coverage',
    description: `${checkedIds} stored ids (${checkedSlots} of them slots) and ${checkedTracks} marquee tracks checked; ${problems.length} new orphans; ${found.length - unexpected.length} of ${KNOWN_OCCURRENCES} known orphan occurrences`,
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
    absent,
    'known orphans that no longer occur in a capture that lists them; after a fix, delete them from KNOWN_ORPHANS',
  ).toEqual([])
})
