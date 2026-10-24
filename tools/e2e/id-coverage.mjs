// LIB-14 id coverage, the comparison half. id-coverage.spec.mjs reads stored and live source nodes
// in the browser; this module decides, without a DOM, which stored edits the live tree would lose.
// projectNativeTree (src/cms/NativeSurface.tsx) resolves every stored id against the live nativeTree
// output, in which an element is a source (a native element) or a slot (the wrapper of a component):
//  - a stored source takes the live source with its id, and the live one wins when the tag differs;
//    failing that it takes the live slot with its id;
//  - a stored slot takes the live slot with its id, or else the live source whatever its tag;
//  - anything else is dropped, and a dropped slot takes its whole component with it;
//  - it keeps the unprojected tree when a stored id repeats, among sources and slots together.

/**
 * @typedef {{ id: string, tag: string, kind: 'source' | 'slot' }} SourceNode
 *   `kind` names the attribute that carries `id`: data-knc-source on a native element, or
 *   data-knc-slot on the div that nativeTree puts around a component. An element has one of them.
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

function duplicates(nodes) {
  const seen = new Set()
  return nodes.filter(({ id }) => seen.has(id) || !seen.add(id))
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
    ...duplicates(stored.nodes).map(({ id, tag }) => ({
      kind: 'duplicate',
      id,
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
