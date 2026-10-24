// LIB-14 id coverage, the comparison half. id-coverage.spec.mjs reads stored and live source nodes
// in the browser; this module decides, without a DOM, which stored edits the live tree would lose.
// projectNativeTree (src/cms/NativeSurface.tsx) drops a stored node whose id is absent from the live
// nativeTree output, keeps the live node instead of a stored one with another tag, and falls back to
// the unprojected tree when a stored id repeats.

/**
 * @typedef {{ id: string, tag: string }} SourceNode
 * @typedef {{ nodes: SourceNode[], tracks: Record<string, string[]> }} SourceTree
 *   `tracks`: marquee track id -> tag shape of each tile. Tile ids hash gallery row ids, which the
 *   sanitised fixture cannot carry, so tiles are compared by shape and left out of `nodes`.
 * @typedef {{
 *   kind: 'duplicate' | 'missing' | 'retagged' | 'reshaped',
 *   id: string,
 *   stored: string,
 *   live: string | null,
 * }} CoverageProblem
 */

function duplicates(nodes) {
  const seen = new Set()
  return nodes.filter(({ id }) => seen.has(id) || !seen.add(id))
}

function nodeProblem({ id, tag }, liveTags) {
  const live = liveTags.get(id)
  if (live === undefined) return [{ kind: 'missing', id, stored: tag, live: null }]
  return live === tag ? [] : [{ kind: 'retagged', id, stored: tag, live }]
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
 * Every stored node the live tree cannot carry. Total: an empty array means every stored id exists
 * live with the same tag and every stored track has the live tile shape.
 * @param {SourceTree} stored
 * @param {SourceTree} live
 * @returns {CoverageProblem[]}
 */
export function coverageProblems(stored, live) {
  const liveTags = new Map(live.nodes.map(({ id, tag }) => [id, tag]))
  return [
    ...duplicates(stored.nodes).map(({ id, tag }) => ({
      kind: 'duplicate',
      id,
      stored: tag,
      live: null,
    })),
    ...stored.nodes.flatMap((node) => nodeProblem(node, liveTags)),
    ...Object.entries(stored.tracks).flatMap((track) => trackProblem(track, live.tracks)),
  ]
}

/** One line per problem, naming the capture, the surface and the id. */
export function describeProblem(where, { kind, id, stored, live }) {
  return `${where}: ${kind} ${id} (stored <${stored}>, live ${live === null ? 'absent' : `<${live}>`})`
}
