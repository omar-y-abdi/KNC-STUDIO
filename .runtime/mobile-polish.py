from pathlib import Path
p = Path('src/admin/cms/Studio.tsx')
p.write_text(p.read_text().replace('            aria-label="Egenskaper"\n', ''))
for name in ['admin-state', 'cms-workspace', 'cms-mobile', 'cms-startup', 'cms-workspace-views', 'cms-workspace-edge']:
    p = Path(f'tools/e2e/{name}.mjs')
    p.write_text(p.read_text().replace("getByRole('button', { name: 'Egenskaper', exact: true })", "getByRole('button', { name: 'Design', exact: true })"))
p = Path('tools/e2e/cms-mobile.mjs')
s = p.read_text().replace("new Event('resize')", "new globalThis.Event('resize')")
needle = "        for (const control of ['Zooma in', 'Zooma ut']) {\n          await page.getByRole('button', { name: control, exact: true }).click()"
replacement = """        for (const control of ['Zooma in', 'Zooma ut']) {
          const previousWidth = (await geometry()).frame.width
          await page.getByRole('button', { name: control, exact: true }).click()
          await page.waitForFunction(({ previousWidth, increase }) => {
            const width = globalThis.document.querySelector('.gjs-frame').getBoundingClientRect().width
            return increase ? width > previousWidth + 1 : width < previousWidth - 1
          }, { previousWidth, increase: control === 'Zooma in' }, { timeout: 3000 })"""
assert needle in s
s = s.replace(needle, replacement)
needle = "        await shot('pages')\n        await page.keyboard.press('Escape')\n"
replacement = """        await shot('pages')
        await page.keyboard.press('Escape')
        // Exercise the same selected-card inspector seen in the owner's screenshots.
        await frame.getByText('Exempel A', { exact: true }).first().click()
        await opener.click()
        const sector = panel.getByRole('button', { name: 'Position & transform', exact: true })
        if (await sector.getAttribute('aria-expanded') !== 'true') await sector.click()
        await sector.scrollIntoViewIfNeeded()
        const fields = await panel.locator('.gjs-sm-property__position').evaluate(node => {
          const panel = node.closest('#cms-inspector').getBoundingClientRect()
          const field = node.getBoundingClientRect()
          return { width: field.width, inside: field.left >= panel.left && field.right <= panel.right }
        })
        check(fields.inside && fields.width > 240, `${prefix}: selected-card position controls have usable width`, fields)
        await shot('position-controls')
        await page.keyboard.press('Escape')
"""
assert needle in s
p.write_text(s.replace(needle, replacement))
p = Path('src/admin/cms/UX-CONTRACT.md')
s = p.read_text()
i = s.index('- Only one compact drawer is active.')
p.write_text(s[:i] + '''- The editing device stays 390 × 844 (Mobile) or 1440 × 900 (Desktop). Fit and zoom change scale, never device dimensions or saved content. Mobile device frames have rounded presentation corners without clipping external selection handles.
- Compact chrome reserves most of the viewport for the canvas. All seven editing commands remain reachable in a single-row dock; the compact Design button opens Egenskaper.
- Compact panels use the visual viewport, including the keyboard-reduced height, rather than the clipped canvas. Pinch zoom remains browser-controlled. Resize/scroll listeners and CSS overrides are removed on desktop transition or unmount.
''' + s[i:])
