"""Pinned correction executed and tested on this repository's GitHub runner."""
import base64
import json
import os
import subprocess
import urllib.request
from pathlib import Path


def read_blob(sha):
    request = urllib.request.Request(
        'https://api.github.com/repos/omar-y-abdi/KNC-STUDIO/git/blobs/' + sha,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request) as response:
        result = json.load(response)
    return base64.b64decode(result['content']).decode()


assert os.environ['GITHUB_REPOSITORY'] == 'omar-y-abdi/KNC-STUDIO'
# The pinned recipe asserts every source replacement and original layout checksum.
recipe = read_blob('bd42959ff7b52304c8f0cee5f319eb28008a66d2')
old = """    assert source.count(old) == 1, f'{path}: expected one occurrence of {old[:100]!r}, got {source.count(old)}'
    target.write_text(source.replace(old, new, 1))"""
new = """    count = source.count(old)
    if path == 'src/ui/Dialog.tsx' and old == '\\n  )\\n}\\n':
        assert count == 2
        before, after = source.rsplit(old, 1)
        target.write_text(before + new + after)
    elif path == 'shared/cms-markup.ts' and old.startswith('      const html = validateMarkup'):
        assert count == 2
        target.write_text(source.replace(old, new, 1))
    else:
        assert count == 1, f'{path}: expected one occurrence of {old[:100]!r}, got {count}'
        target.write_text(source.replace(old, new, 1))"""
assert recipe.count(old) == 1
exec(compile(recipe.replace(old, new), '<pinned-cms-correction>', 'exec'))


def replace(path, old, new, count=1):
    target = Path(path)
    source = target.read_text()
    assert source.count(old) == count, f'{path}: {old[:80]!r}: {source.count(old)} matches'
    target.write_text(source.replace(old, new))


replace('src/admin/cms/editorPolicy.ts',
    "    if (attrs['data-knc-slot'] || attrs['data-knc-required'] === 'true') return true",
    "    if (attrs['data-knc-slot'] || (current === component && attrs['data-knc-required'] === 'true')) return true")
replace('src/app/App.tsx', "import { previewCustomerPort } from '../cms/PreviewPorts'",
    "import { previewCustomerPort } from '../cms/PreviewPorts'\nimport { defaultSiteChromePort } from '../site/adapters'\nimport type { SiteChromePort } from '../site/port'\n\nconst sourceChromePort: SiteChromePort = { load: (lang) => defaultSiteChromePort.load(lang) }")
replace('src/app/App.tsx', 'const { chrome, metadataReady } = useSiteChrome(lang)',
    'const { chrome, metadataReady } = useSiteChrome(lang, preview ? sourceChromePort : undefined)')
replace('src/app/App.tsx', "import type { JSX } from 'preact'", "import type { JSX, ComponentChildren } from 'preact'")
replace('src/app/App.tsx', '{ preview?: SitePreview } = {}', '{ preview?: SitePreview; children?: ComponentChildren } = {}')
for path in ['/', '/about', '/booking', '/my-bookings']:
    replace('src/app/Root.tsx', f'<Route path="{path}" component={{App}} />', f'<Route path="{path}"><App /></Route>')
replace('src/admin/cms/NativeSource.tsx', 'type SourceContext = {', 'interface SourceContext {')
replace('src/admin/cms/nativePages.ts', 'type Capture = {', 'interface Capture {')
replace('src/cms/NativeSurface.tsx', 'delete props[name]', 'Reflect.deleteProperty(props, name)')
replace('src/cms/NativeSurface.tsx', 'const slot = h(', 'const slot = h<Record<string, unknown>>(')
replace('src/cms/NativeSurface.tsx', 'const node = h(', 'const node = h<Record<string, unknown>>(')
replace('src/cms/NativeSurface.tsx', ') as NativeNode', ')', count=2)
replace('tests/unit/cmsCorePages.test.ts', "  result.presentation.pages[0]!.content.sv.html = '<main>Owner edit</main>'",
    "  const first = result.presentation.pages[0]\n  if (!first) throw new Error('Missing supplied source page')\n  first.content.sv.html = '<main>Owner edit</main>'")

# Keep actual layout files in their established locations; no one-use Source wrapper modules.
# The existing TypeScript parser locates the exported function's own return, not nested callbacks.
subprocess.run(['node', '--input-type=module', '-'], input=r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const files = [
  ['src/app/DesktopSite', 'DesktopSite', '`desktop-${props.view}`', '../cms/NativeSurface', true],
  ['src/app/MobileSite', 'MobileSite', '`mobile-${props.view}`', '../cms/NativeSurface', false],
  ['src/about/AboutSection', 'AboutSection', "'about'", '../cms/NativeSurface', true],
];
for (const [base, name, surface, nativeImport, ports] of files) {
  const filename = base + 'Source.tsx';
  let source = fs.readFileSync(filename, 'utf8');
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(fn?.body);
  const returns = fn.body.statements.filter(ts.isReturnStatement);
  assert.equal(returns.length, 1);
  const expression = returns[0].expression;
  assert(expression);
  source = source.slice(0, expression.getStart(parsed)) +
    `useNativeSurface(${source.slice(expression.getStart(parsed), expression.end)}, ${surface}, props.lang, props.mode)` +
    source.slice(expression.end);
  let injection = '';
  if (ports) {
    injection = name === 'DesktopSite'
      ? '\n  const previewPorts = useContext(PreviewPorts)\n  if (previewPorts) props = { ...props, previewPorts }\n'
      : '\n  const previewPorts = useContext(PreviewPorts)\n  if (previewPorts) props = { ...props, port: previewPorts.reviews, barbersPort: previewPorts.barbers, aboutContentPort: previewPorts.aboutContent, galleryPort: previewPorts.gallery, challengeEnabled: false }\n';
  }
  source = source.slice(0, fn.body.getStart(parsed) + 1) + injection + source.slice(fn.body.getStart(parsed) + 1);
  source = `import { useNativeSurface } from '${nativeImport}'\n` +
    (ports ? "import { useContext } from 'preact/hooks'\nimport { PreviewPorts } from '../cms/PreviewPorts'\n" : '') + source;
  fs.writeFileSync(base + '.tsx', source);
  fs.unlinkSync(filename);
}
''', text=True, check=True)
replace('src/cms/PreviewPorts.ts', "from '../app/DesktopSiteSource'", "from '../app/DesktopSite'")
replace('tests/unit/desktopTopPanel.test.ts', 'src/app/DesktopSiteSource.tsx', 'src/app/DesktopSite.tsx')

# Legacy runtime-island protection still applies; tests supply their own minimal contract fixtures.
replace('tests/unit/cmsRuntimeSlots.test.ts', "import { ensureCorePages } from '../../src/admin/cms/corePages'\n", '')
replace('tests/unit/cmsRuntimeSlots.test.ts', '    const document = ensureCorePages(emptyDocument())', '''    const document = emptyDocument()
    const variant = { html: `<main><div id="${id}"></div></main>`, css: { light: '', dark: '' } }
    document.presentation.pages.push({
      id: '10000000-0000-4000-8000-000000000001', path, kind: 'page',
      name: { sv: path, en: path }, title: { sv: path, en: path },
      description: { sv: '', en: '' }, inMenu: false,
      content: { sv: structuredClone(variant), en: structuredClone(variant) },
    })
    expect(() => validateDocumentMarkupPlacements(document, policy)).not.toThrow()''')

test = read_blob('7418927cf8dd11a9f8cdfea81526239b8e138816')
test = test.replace('structuredClone(body.document)', 'globalThis.structuredClone(body.document)')
test = test.replace("() => document.querySelector('.cms-status')", "() => globalThis.document.querySelector('.cms-status')")
test = test.replace('CSS.escape(element.id)', 'globalThis.CSS.escape(element.id)')
test = test.replace('getComputedStyle(node).color', 'globalThis.getComputedStyle(node).color')
Path('tools/e2e/cms-native.mjs').write_text(test)
Path('tests/unit/cmsNativeSecurity.test.ts').write_text(read_blob('cb2a63f1ff83ffc970e1ad81afc8ec7aef7306d8'))
harness = Path('tools/e2e/admin-harness.tsx')
harness.write_text(harness.read_text() + "\nexport { default as cmsGrapes } from 'grapesjs'\n")
replace('tools/e2e/admin-state.mjs', 'async function mountCmsStudio(page) {',
    "async function mountCmsStudio(page) {\n  const { nativeBackend } = await import('./cms-native.mjs')\n  await nativeBackend(page.context())")
replace('tools/e2e/admin-state.mjs', "    return route.fulfill({ status: 401, headers, body: '{}' })", '    return route.fallback()')
# Keep the browser regression runnable in the permanent PR CI after the temporary recipe is removed.
replace('.github/workflows/ci.yml',
    '          BASE_URL=http://127.0.0.1:4188 ADMIN_E2E_SCENARIO=cms-shell npm run test:e2e:admin',
    '          BASE_URL=http://127.0.0.1:4188 ADMIN_E2E_SCENARIO=cms-shell npm run test:e2e:admin\n          BASE_URL=http://127.0.0.1:4188 node tools/e2e/cms-native.mjs')
print('Applied observed corrections. No tests or compiler gates were disabled. No branch ref was changed.')
