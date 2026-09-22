from pathlib import Path

p = Path('src/admin/cms/DomainPanels.tsx')
s = p.read_text()
assert s.count('<div class="cms-segment" aria-label="Mejlbredd">') == 1
p.write_text(s.replace('<div class="cms-segment" aria-label="Mejlbredd">', '<div class="cms-segment" role="group" aria-label="Mejlbredd">'))

p = Path('src/admin/cms/studio.css')
s = p.read_text()
marker = '.knc-cms-studio .gjs-layer-title {\n'
assert s.count(marker) == 1
s = s.replace(marker, '.knc-cms-studio .gjs-layer-name {\n  color: var(--ink);\n  font-weight: 500;\n}\n' + marker)
marker = '@media (max-height: 550px) and (max-width: 900px) {\n'
assert s.count(marker) == 1
s = s.replace(marker, marker + '  /* Short viewports need the whole height for the active modal drawer. */\n  .cms-library,\n  .cms-inspector {\n    position: fixed;\n    top: 0;\n    bottom: 0;\n    height: auto;\n  }\n  .cms-backdrop {\n    position: fixed;\n  }\n')
p.write_text(s)

p = Path('src/admin/cms/Resources.tsx')
s = p.read_text()
assert s.count('<CmsIcon name="plus" /> + Ladda upp') == 1
s = s.replace('<CmsIcon name="plus" /> + Ladda upp', '<CmsIcon name="plus" /> Ladda upp')
s = s.replace('publiceras med Save /\n              Publicera.', 'publiceras med\n              Publicera.')
p.write_text(s)

p = Path('tools/e2e/cms-workspace-edge.mjs')
s = p.read_text()
marker = "    await run('block-grid', async () => {"
assert s.count(marker) == 1
s = s.replace(marker, """    await run('layer-type', async () => {
      await page.getByRole('tab', { name: 'Lager', exact: true }).click()
      const layers = page.locator('.gjs-layer-name')
      await layers.first().waitFor()
      const weights = await layers.evaluateAll((nodes) =>
        nodes.map((node) => Number(globalThis.getComputedStyle(node).fontWeight)),
      )
      check(
        weights.length > 0 && weights.every((weight) => weight >= 400),
        `${name}: nested layer labels retain a readable body weight`,
        weights,
      )
      await shot('layer-type')
    })
""" + marker)
p.write_text(s)

p = Path('src/admin/cms/DESIGN.md')
s = p.read_text().replace("header: '65px'", "header: '72px'").replace('Header 65px;', 'Header 72px;')
s = s.replace('Website style pairs a 300px palette/type form with a live public preview; below 1100px these stack.', 'Website style pairs a 280px palette/type form with a live public preview; the form narrows at 1100px and the regions stack at 900px.')
s = s.replace('short landscape screens use one compact row.', 'short landscape screens use one compact row. An open drawer takes the full height on short screens so its controls are not squeezed between two toolbars.')
s = s.replace('property text weight/contrast and native-preview', 'property/layer text weight, contrast, usable landscape drawer space and native-preview')
p.write_text(s)
