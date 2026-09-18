import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const source = readFileSync('src/admin/AdminShell.tsx', 'utf8')
const tree = ts.createSourceFile(
  'AdminShell.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const originalTabs = [
  'schedule',
  'bookings',
  'services',
  'profile',
  'allBookings',
  'barbers',
  'site',
  'about',
  'mail',
  'settings',
]

function tabEntries(): string[] {
  let entries: string[] = []
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === 'TABS' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      entries = node.initializer.elements.flatMap((entry) => {
        if (!ts.isObjectLiteralExpression(entry)) return []
        const id = entry.properties.find(
          (property) => ts.isPropertyAssignment(property) && property.name.getText(tree) === 'id',
        )
        return id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer)
          ? [id.initializer.text]
          : []
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return entries
}

describe('additive CMS rollout', () => {
  it('keeps every original admin tab in its original order', () => {
    expect(tabEntries()).toEqual(originalTabs)
  })
  it('does not hide the existing owner profile tab', () => {
    expect(source.includes('TABS.filter((tab) => isOwner || !tab.ownerOnly)')).toBe(true)
    expect(source.includes("(!isOwner || tab.id !== 'profile')")).toBe(false)
  })
  it.each(['ProfileView', 'SiteView', 'AboutView', 'MailView', 'BarbersView'])(
    'retains the existing %s renderer and source file',
    (component) => {
      expect(source.includes(`const ${component} = lazy`)).toBe(true)
      expect(source.includes(`<${component}`)).toBe(true)
      expect(readFileSync(`src/admin/views/${component}.tsx`, 'utf8').length).toBeGreaterThan(100)
    },
  )
  it('adds owner-only editing without bypassing pending schedule changes', () => {
    expect(source.includes("navigate('/admin/cms/')")).toBe(true)
    expect(source.includes('disabled={navigationLocked}')).toBe(true)
    expect(source.includes('if (navigationLocked) return')).toBe(true)
    expect(source.includes("props.lang === 'sv' ? 'Redigering' : 'Editing'")).toBe(true)
  })
  it('keeps the old navigation state and roster refresh contract', () => {
    expect(source.includes('reload: reloadBarbers')).toBe(true)
    expect(source.includes('onRosterChanged={() => void reloadBarbers()}')).toBe(true)
    expect(source.includes('tabFromAdminUrl(window.location.href, visibleTabIds')).toBe(true)
  })
})
