import { generate, ident, parse, walk } from 'css-tree'

// What a stylesheet declares, in the order GrapesJS getCss keeps. getCss first writes the plain
// rules in model order: qualified rules, and the one envelope rule parseCanvasCss makes of each
// top-level at-rule that holds a layer, a direct at-rule or keyframes. It then writes the other
// at-rules grouped by head, with the heads sorted by query width and each head's rules in model
// order. So the plain rules form one sequence and each head's rules another. A leaf is a block
// with its declarations in order and the at-rules and selectors around it. A layer statement, and
// a named layer block that declares nothing, is a leaf in its place too, since it fixes the order
// of the layers it names. An empty anonymous layer fixes nothing, so it is no leaf. The leading
// `& ` that getCss keeps and readCanvasCss removes is dropped, and an empty rule outside any other
// rule, which canvasRules leaves out, is no leaf. Equal results prove the same declarations in
// the same contexts, in the same order within the plain sequence, layer order included, and
// within each head. They cannot prove equal bytes, the interleaving of plain rules with grouped
// ones, or the order between rules under different heads: getCss reorders both, so a cascade
// change there needs a cascade probe of its own.
export function styleLeaves(source) {
  const plain = []
  const groups = {}
  for (const node of parse(source).children) {
    const leaves = leavesOf(node)
    if (leaves.length === 0) continue
    const head = groupHead(node)
    if (head === undefined) plain.push(...leaves)
    else (groups[head] ??= []).push(...leaves)
  }
  return { plain, groups }
}

const nameOf = (atrule) => ident.decode(atrule.name).toLowerCase()
const headOf = (atrule) =>
  `@${atrule.name} ${atrule.prelude ? generate(atrule.prelude) : ''}`.trim()

// The head getCss groups a top-level item under, or undefined when getCss writes it as a plain
// rule: a qualified rule, or an at-rule that parseCanvasCss keeps as one envelope.
function groupHead(node) {
  if (node.type !== 'Atrule' || ['keyframes', '-webkit-keyframes'].includes(nameOf(node)))
    return undefined
  if (node.block?.children.some((child) => child.type === 'Atrule')) return undefined
  let layered = false
  walk(node, (child) => {
    if (child.type === 'Rule') return walk.skip
    if (child.type === 'Atrule' && nameOf(child) === 'layer') layered = true
    return undefined
  })
  return layered ? undefined : headOf(node)
}

function leavesOf(root) {
  const leaves = []
  const enclosing = []
  const starts = []
  const declarationsOf = (node) =>
    node.block.children
      .toArray()
      .filter((child) => child.type !== 'Rule' && child.type !== 'Atrule')
      .map((child) => generate(child))
  walk(root, {
    enter(node) {
      if (node.type === 'Atrule') {
        const head = headOf(node)
        if (node.block) {
          starts.push(leaves.length)
          const declarations = declarationsOf(node)
          if (declarations.length > 0)
            leaves.push(JSON.stringify([...enclosing, head, declarations]))
          enclosing.push(head)
        } else leaves.push(JSON.stringify([...enclosing, head]))
      }
      if (node.type === 'Rule') {
        const selector = generate(node.prelude).replace(/^& /, '')
        const nested = enclosing.some((head) => !head.startsWith('@'))
        if (nested || !node.block.children.isEmpty)
          leaves.push(JSON.stringify([...enclosing, selector, declarationsOf(node)]))
        enclosing.push(selector)
      }
    },
    leave(node) {
      if (node.type === 'Rule') enclosing.pop()
      if (node.type !== 'Atrule' || !node.block) return
      const head = enclosing.pop()
      const declaredNothing = starts.pop() === leaves.length
      if (declaredNothing && nameOf(node) === 'layer' && node.prelude)
        leaves.push(JSON.stringify([...enclosing, head]))
    },
  })
  return leaves
}
