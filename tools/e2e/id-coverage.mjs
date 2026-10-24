// LIB-14 id coverage, the comparison half. id-coverage.spec.mjs reads stored and live source nodes
// in the browser; this module decides, without a DOM, which stored edits the live tree would lose.
// projectNativeTree (src/cms/NativeSurface.tsx) resolves every stored id against the live nativeTree
// output, in which an element is a source (a native element) or a slot (the wrapper of a component):
//  - an element that carries both attributes is resolved as a slot, which is read first, while
//    duplicates are counted by its source id, which is the one projectNativeTree registers;
//  - a stored source takes the live source with its id, and the live one wins when the tag differs;
//    failing that it takes the live slot with its id;
//  - a stored slot takes the live slot with its id, or else the live source whatever its tag;
//  - anything else is dropped, and a dropped slot takes its whole component with it;
//  - it keeps the unprojected tree when a stored id repeats, among sources and slots together.

/**
 * @typedef {{ id: string, tag: string, kind: 'source' | 'slot', identity?: string }} SourceNode
 *   `kind` names the attribute that carries `id`: data-knc-source on a native element, or
 *   data-knc-slot on the div that nativeTree puts around a component. nativeTree emits one of
 *   them; a stored element can carry both, and then `kind` is 'slot' with the slot id in `id` and
 *   the source id in `identity`, the id that counts for duplicates.
 * @typedef {{ nodes: SourceNode[], tracks: Record<string, string[]> }} SourceTree
 *   `tracks`: marquee track id -> tag shape of each tile. Tile ids hash gallery row ids, which the
 *   sanitised fixture cannot carry, so tiles are compared by shape and left out of `nodes`.
 * @typedef {{
 *   kind: 'duplicate' | 'missing' | 'missing-slot' | 'retagged' | 'reshaped',
 *   id: string,
 *   stored: string,
 *   live: string | null,
 * }} CoverageProblem
 */

/**
 * What one element's attributes make of it, as projectNativeTree reads an element: the slot
 * attribute decides how it resolves, the source id (else the slot id) is its identity.
 * @param {{ source: string | null, slot: string | null, tag: string }} element
 * @returns {SourceNode | null} null for an element with neither attribute
 */
export function nodeOf({ source, slot, tag }) {
  if (slot !== null)
    return { id: slot, tag, kind: 'slot', ...(source === null ? {} : { identity: source }) }
  return source === null ? null : { id: source, tag, kind: 'source' }
}

/**
 * A page's elements as a SourceTree.
 * @param {{ elements: { source: string | null, slot: string | null, tag: string }[], tracks: Record<string, string[]> }} read
 * @returns {SourceTree}
 */
export function sourceTree({ elements, tracks }) {
  return { nodes: elements.map(nodeOf).filter((node) => node !== null), tracks }
}

function duplicates(nodes) {
  const seen = new Set()
  return nodes.filter((node) => {
    const identity = node.identity ?? node.id
    return seen.has(identity) || !seen.add(identity)
  })
}

// nativeTree keeps sources and slots apart (its `nodes` and `slots` maps); so does the lookup.
function liveIndex(nodes) {
  const ofKind = (kind) => nodes.filter((node) => node.kind === kind)
  return {
    sources: new Map(ofKind('source').map(({ id, tag }) => [id, tag])),
    slots: new Set(ofKind('slot').map(({ id }) => id)),
  }
}

// A dropped slot takes its component with it, so it gets its own kind.
function missing({ id, tag, kind }) {
  return { kind: kind === 'slot' ? 'missing-slot' : 'missing', id, stored: tag, live: null }
}

function sourceProblem(node, { sources, slots }) {
  const live = sources.get(node.id)
  if (live === undefined) return slots.has(node.id) ? [] : [missing(node)]
  return live === node.tag ? [] : [{ kind: 'retagged', id: node.id, stored: node.tag, live }]
}

function slotProblem(node, { sources, slots }) {
  return slots.has(node.id) || sources.has(node.id) ? [] : [missing(node)]
}

function nodeProblem(node, index) {
  return node.kind === 'slot' ? slotProblem(node, index) : sourceProblem(node, index)
}

// The tile count follows the viewport (GalleryMarquee repeats tiles to fill the row), so a track is
// compared by its distinct tile shapes.
function distinctShapes(shapes) {
  return [...new Set(shapes)].sort().join(' ')
}

function trackProblem([id, shapes], liveTracks) {
  const stored = distinctShapes(shapes)
  const live = liveTracks[id] === undefined ? null : distinctShapes(liveTracks[id])
  return live === stored ? [] : [{ kind: 'reshaped', id, stored, live }]
}

/**
 * Every stored node the live tree cannot carry. Total: an empty array means every stored id
 * resolves live as projectNativeTree resolves it and every stored track has the live tile shape.
 * @param {SourceTree} stored
 * @param {SourceTree} live
 * @returns {CoverageProblem[]}
 */
export function coverageProblems(stored, live) {
  const index = liveIndex(live.nodes)
  return [
    ...duplicates(stored.nodes).map(({ id, identity, tag }) => ({
      kind: 'duplicate',
      id: identity ?? id,
      stored: tag,
      live: null,
    })),
    ...stored.nodes.flatMap((node) => nodeProblem(node, index)),
    ...Object.entries(stored.tracks).flatMap((track) => trackProblem(track, live.tracks)),
  ]
}

/** One line per problem, naming the capture, the surface and the id. */
export function describeProblem(where, { kind, id, stored, live }) {
  return `${where}: ${kind} ${id} (stored <${stored}>, live ${live === null ? 'absent' : `<${live}>`})`
}

/**
 * @typedef {{ lang: string, mode: string, device: string, scene: string }} Capture
 *   One render of the source renderer: language, colour mode, device size and scene.
 * @typedef {CoverageProblem & { surface: string }} Orphan
 *   A problem of one stored surface.
 * @typedef {{ orphan: Orphan, captures: Capture[] }} KnownOrphan
 *   An orphan that HEAD already has, with every capture it must occur in, once each.
 */

/** The capture and the surface that a problem was found in, as `describeProblem` prints them. */
export function describeWhere({ lang, mode, device, scene }, surface) {
  return `${surface} (${device} ${scene} ${lang} ${mode})`
}

/** One orphan in one capture: the line that a failure prints and that the ratchet counts. */
export function describeOrphan(capture, { surface, ...problem }) {
  return describeProblem(describeWhere(capture, surface), problem)
}

// `keys` without one occurrence of each of `others`, so repeats count.
function without(keys, others) {
  const cancelled = new Map()
  for (const key of others) cancelled.set(key, (cancelled.get(key) ?? 0) + 1)
  return keys.filter((key) => {
    const left = cancelled.get(key) ?? 0
    if (left > 0) cancelled.set(key, left - 1)
    return left === 0
  })
}

/**
 * The ratchet of known orphans, exact to the capture. `unexpected`: orphans found beyond what the
 * known ones list (a new orphan, a known one in a capture that does not list it, a repeat).
 * `absent`: listed occurrences that were not found (fixed, or gone from one capture). The ratchet
 * holds when both are empty.
 * @param {{ capture: Capture, orphan: Orphan }[]} found
 * @param {KnownOrphan[]} known
 * @returns {{ unexpected: string[], absent: string[] }}
 */
export function ratchetVerdict(found, known) {
  const seen = found.map(({ capture, orphan }) => describeOrphan(capture, orphan))
  const listed = known.flatMap(({ orphan, captures }) =>
    captures.map((capture) => describeOrphan(capture, orphan)),
  )
  return { unexpected: without(seen, listed), absent: without(listed, seen) }
}
