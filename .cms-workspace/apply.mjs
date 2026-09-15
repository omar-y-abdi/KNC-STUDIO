import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve(process.argv[2])
const path = resolve(root, 'package.json'), pkg = JSON.parse(readFileSync(path, 'utf8'))
pkg.dependencies.grapesjs = '0.23.6'
pkg.dependencies.parse5 = '8.0.1'
pkg.dependencies['css-tree'] = '3.2.1'
pkg.dependencies.fontkit = '2.0.4'
pkg.devDependencies['@types/css-tree'] = '2.3.11'
pkg.devDependencies['@types/fontkit'] = '2.0.9'
writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n')
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: root, stdio: 'inherit' })
const assets = []
function visit(folder, prefix='') {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    if (item.isDirectory()) visit(resolve(folder, item.name), `${prefix}${item.name}/`)
    else if (/\.(?:png|jpe?g|webp|svg|gif|avif|woff2)$/i.test(item.name)) assets.push(`/${prefix}${item.name}`)
  }
}
visit(resolve(root, 'public'))
mkdirSync(resolve(root, 'shared'), { recursive: true })
writeFileSync(resolve(root, 'shared/cms-built-assets.ts'), '// Source-owned assets; this inventory contains paths, never embedded file bytes.\nexport const CMS_BUILT_ASSETS = ' + JSON.stringify(assets.sort(), null, 2) + ' as const\n')
