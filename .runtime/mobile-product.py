from pathlib import Path

p = Path('src/admin/cms/Editor.tsx')
s = p.read_text().replace("import { compactWorkspace } from './useResponsivePanels'\n", '')
start = s.index("  const mobile = editor.Devices.get('Mobile')", s.index('function fitEditor('))
end = s.index('  editor.Canvas.fitViewport', start)
s = s[:start] + '''  // Device dimensions describe the page, not the space around the editor.
  // Fit changes only scale; changing height also changes vh units and breakpoints.
''' + s[end:]
s = s.replace('class="cms-editor-canvas"', 'class="cms-editor-canvas"\n        data-device={props.device}')
p.write_text(s)
p = Path('src/admin/cms/useResponsivePanels.ts')
s = p.read_text()
needle = '  useLayoutEffect(() => {\n    if (!ready || !active'
assert needle in s
s = s.replace(needle, '''  useLayoutEffect(() => {
    const element = root.current
    const viewport = window.visualViewport
    if (!ready || !compact || !element || !viewport) return
    const resize = (): void => {
      // The keyboard changes the visual viewport, not CSS viewport height on iOS.
      // Leave pinch zoom to the browser instead of resizing the app while zooming.
      if (viewport.scale !== 1) return
      element.style.setProperty('--cms-viewport-height', `${viewport.height}px`)
      element.style.setProperty('--cms-viewport-top', `${viewport.offsetTop}px`)
    }
    resize()
    viewport.addEventListener('resize', resize)
    viewport.addEventListener('scroll', resize)
    return () => {
      viewport.removeEventListener('resize', resize)
      viewport.removeEventListener('scroll', resize)
      element.style.removeProperty('--cms-viewport-height')
      element.style.removeProperty('--cms-viewport-top')
    }
  }, [ready, compact, root])
  useLayoutEffect(() => {
    if (!ready || !active''', 1)
p.write_text(s)
p = Path('src/admin/cms/Studio.tsx')
s = p.read_text()
needle = 'aria-controls="cms-inspector"'
assert s.count(needle) == 1
s = s.replace(needle, needle + '\n            aria-label="Egenskaper"').replace('<span>Egenskaper</span>', '<span>Design</span>')
p.write_text(s)
p = Path('src/admin/cms/studio.css')
s = p.read_text()
start = s.index('@media (max-width: 900px) {\n  .cms-topbar')
end = s.index('@media (max-width: 359px)', start)
prefix, m, suffix = s[:start], s[start:end], s[end:]
m = m.replace('@media (max-width: 900px) {', '''@media (max-width: 900px) {
  .knc-cms-studio {
    --radius: 10px;
    top: var(--cms-viewport-top, 0px);
    bottom: auto;
    height: var(--cms-viewport-height, 100dvh);
  }''', 1)
m = m.replace('gap: 8px 12px;\n    min-height: 108px;\n    padding: 12px 16px;', 'gap: 4px 8px;\n    min-height: 88px;\n    padding: 6px 12px;')
m = m.replace('    min-height: 42px;', '    min-height: 40px;', 1)
m = m.replace('grid-area: publish;\n    min-height: 44px;\n    padding-inline: 14px;', 'grid-area: publish;\n    justify-self: end;\n    min-height: 40px;\n    padding: 7px 12px;')
m = m.replace('    min-height: 32px;\n    padding: 5px 7px;', '    min-height: 28px;\n    padding: 4px 7px;', 1)
m = m.replace('''    position: absolute;
    inset: 0 auto 0 0;
    width: min(330px, calc(100vw - 32px));
    z-index: 30;
    box-shadow: 12px 0 36px #19241033;''', '    left: 8px;', 1)
m = m.replace('''    position: absolute;
    inset: 0 0 0 auto;
    width: min(350px, calc(100vw - 24px));
    height: 100%;
    margin-top: 0;
    z-index: 30;
    box-shadow: -12px 0 36px #19241033;''', '    right: 8px;\n    margin-top: 0;', 1)
m = m.replace('  .cms-inspector-heading {', '''  .cms-library,
  .cms-inspector {
    position: fixed;
    top: calc(var(--cms-viewport-top, 0px) + 8px);
    bottom: auto;
    height: calc(var(--cms-viewport-height, 100dvh) - 16px);
    width: min(440px, calc(100vw - 16px));
    z-index: 30;
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 16px 48px #19241040;
  }
  .cms-inspector-heading {''', 1)
m = m.replace('    min-height: 80px;\n    gap: 4px 8px;\n    padding: 6px 12px;', '    min-height: 68px;\n    gap: 2px 8px;\n    padding: 4px 10px;', 1)
m = m.replace('    min-height: 22px;', '    min-height: 18px;', 1)
m = m.replace('  .cms-backdrop {\n    position: absolute;\n    inset: 0;', '  .cms-backdrop {\n    position: fixed;\n    inset: 0;', 1)
m = m.replace('    min-height: 66px;\n    padding: 5px 6px max(5px, env(safe-area-inset-bottom));', '    min-height: 62px;\n    padding: 5px 4px max(5px, env(safe-area-inset-bottom));')
m = m.replace('grid-template-columns: repeat(5, minmax(0, 1fr));', 'grid-template-columns: repeat(7, minmax(0, 1fr));', 1)
m = m.replace('''    border-radius: 0;
    box-shadow: none;
    border: 0;
  }
  .cms-mobile-tools''', '''    border-radius: 14px 14px 0 0;
    box-shadow: 0 -3px 14px #1924100a;
    border: 0;
  }
  .cms-mobile-tools''', 1)
m = m.replace('''    grid-column: 1 / -1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-bottom: 1px solid #56604d;
    padding-bottom: 4px;''', '''    grid-column: span 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-right: 1px solid #56604d;''', 1)
m = m.replace('    flex-direction: row;\n    min-height: 40px;\n    font-size: 12px;', '    flex-direction: column;\n    min-height: 48px;\n    font-size: 10px;', 1)
m = m.replace('    padding: 6px 2px;\n    font-size: 10px;', '    padding: 5px 1px;\n    font-size: 10px;', 1)
m = m.replace('  .cms-editor-wrap {', '''  .cms-editor-canvas[data-device='Mobile'] .gjs-frame,
  .cms-editor-canvas[data-device='Mobile'] .gjs-frame-wrapper {
    border-radius: 18px;
  }
  .cms-editor-wrap {''', 1)
suffix = suffix.replace('    gap: 8px;\n  }\n  .cms-brand-mark', '    gap: 4px 8px;\n  }\n  .cms-brand-mark', 1)
suffix = suffix.replace('''  /* Short viewports need the whole height for the active modal drawer. */
  .cms-library,
  .cms-inspector {
    position: fixed;
    top: 0;
    bottom: 0;
    height: auto;
  }
  .cms-backdrop {
    position: fixed;
  }
''', '')
a = suffix.index('@media (max-height: 550px) and (min-width: 600px)')
b = suffix.index('@media (prefers-reduced-motion: reduce)', a)
p.write_text(prefix + m + suffix[:a] + suffix[b:])
p = Path('tools/e2e/cms-mobile.mjs')
s = Path('/tmp/cms-mobile.mjs').read_text().replace('data-knc-surface="mobile-about"', 'data-knc-surface="about"')
needle = "          await page.getByRole('button', { name: 'Dator', exact: true }).click()\n"
assert needle in s
s = s.replace(needle, needle + "          await page.waitForFunction(() => { const frame = globalThis.document.querySelector('.gjs-frame'); return frame?.contentWindow.innerWidth === 1440 && frame.contentWindow.innerHeight === 900 }, null, { timeout: 3000 })\n")
p.write_text(s)
p = Path('.github/workflows/cms-workspace.yml')
s = p.read_text().replace('for suite in cms-workspace cms-workspace-edge', 'for suite in cms-mobile cms-workspace cms-workspace-edge').replace("required = {'cms-workspace',", "required = {'cms-mobile', 'cms-workspace',")
p.write_text(s)
