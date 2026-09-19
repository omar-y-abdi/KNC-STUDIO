"""Pinned CMS correction, executed and verified on the repository's GitHub runner only."""
import base64
import json
import os
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


def replace(path, old, new):
    target = Path(path)
    source = target.read_text()
    assert source.count(old) == 1, f'{path}: {old[:80]!r}'
    target.write_text(source.replace(old, new))


replace('src/admin/cms/editorPolicy.ts',
    "    if (attrs['data-knc-slot'] || attrs['data-knc-required'] === 'true') return true",
    "    if (attrs['data-knc-slot'] || (current === component && attrs['data-knc-required'] === 'true')) return true")
replace('src/app/App.tsx', "import { previewCustomerPort } from '../cms/PreviewPorts'",
    "import { previewCustomerPort } from '../cms/PreviewPorts'\nimport { defaultSiteChromePort } from '../site/adapters'\nimport type { SiteChromePort } from '../site/port'\n\nconst sourceChromePort: SiteChromePort = { load: (lang) => defaultSiteChromePort.load(lang) }")
replace('src/app/App.tsx', 'const { chrome, metadataReady } = useSiteChrome(lang)',
    'const { chrome, metadataReady } = useSiteChrome(lang, preview ? sourceChromePort : undefined)')

test = read_blob('7418927cf8dd11a9f8cdfea81526239b8e138816')
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
print('Applied correction. No branch ref was changed. Repository gates run next.')
