import { generate, ident, parse, walk } from 'css-tree'

// What a stylesheet declares, in the order GrapesJS getCss keeps. getCss first writes the plain
// rules in model order: qualified rules, and the one envelope rule parseCanvasCss makes of each
// top-level at-rule that holds a direct at-rule or keyframes. It then writes the other
// at-rules grouped by head, with the heads sorted by query width and each head's rules in model
// order. So the plain rules form one sequence and each head's rules another. A leaf is a run of a
// block's declarations in order, with the at-rules and selectors around it. A nested rule ends a
// run: the declarations after it follow it in the cascade, so they form the next run, a leaf after
// the nested rule's own. The leading `& ` that getCss keeps and readCanvasCss removes is
// dropped, and an empty rule outside any other rule, which canvasRules leaves out, is no leaf.
// Equal results prove the same declarations in the same contexts, in the same order within the
// plain sequence, the order around nested rules included, and within each head.
// They cannot prove equal bytes, the interleaving of plain rules with grouped ones, or the order
// between rules under different heads: getCss reorders both, so a cascade change there needs a
// cascade probe of its own.
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
  return headOf(node)
}

function leavesOf(root) {
  const leaves = []
  const enclosing = []
  const nests = (node) => node.type === 'Rule' || node.type === 'Atrule'
  // The declarations from a block item up to the next nested rule.
  const runFrom = (item) => {
    const declarations = []
    for (let next = item; next && !nests(next.data); next = next.next)
      declarations.push(generate(next.data))
    return declarations
  }
  walk(root, {
    enter(node) {
      if (node.type === 'Atrule' && node.block) {
        const head = headOf(node)
        const declarations = runFrom(node.block.children.head)
        if (declarations.length > 0) leaves.push(JSON.stringify([...enclosing, head, declarations]))
        enclosing.push(head)
      }
      if (node.type === 'Rule') {
        const selector = generate(node.prelude).replace(/^& /, '')
        const nested = enclosing.some((head) => !head.startsWith('@'))
        if (nested || !node.block.children.isEmpty)
          leaves.push(JSON.stringify([...enclosing, selector, runFrom(node.block.children.head)]))
        enclosing.push(selector)
      }
    },
    leave(node, item) {
      if (node.type === 'Rule' || (node.type === 'Atrule' && node.block)) enclosing.pop()
      // The declarations after a nested rule follow it in the cascade: a leaf of the enclosing
      // block after the nested rule's own.
      if (!nests(node)) return
      const declarations = runFrom(item?.next)
      if (declarations.length > 0) leaves.push(JSON.stringify([...enclosing, declarations]))
    },
  })
  return leaves
}
