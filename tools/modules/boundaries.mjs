import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createRequire } from 'node:module'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const modulePaths = {
  'public-web': 'modules/public-web',
  'staff-admin': 'modules/staff-admin',
  studio: 'modules/studio',
  backend: 'supabase',
  'content-contracts': 'packages/content-contracts',
  'backend-contracts': 'packages/backend-contracts',
}
// Direction is consumer -> provider. Root composition may load all entrypoints.
export const allowedDependencies = {
  'public-web': ['content-contracts', 'backend-contracts'],
  'staff-admin': ['public-web', 'backend-contracts'],
  studio: ['public-web', 'staff-admin', 'content-contracts', 'backend-contracts'],
  backend: ['public-web', 'content-contracts', 'backend-contracts'],
  'content-contracts': [],
  'backend-contracts': ['content-contracts'],
}
export const ownerOf = (path) =>
  Object.keys(modulePaths).find((id) => path.startsWith(`${modulePaths[id]}/`)) ?? null

const publicInterfaces = {
  studio: [
    'mobile-layout',
    'site-chrome',
    'backend-config',
    'business',
    'business-slots',
    'preview',
    'route-metadata',
    'server/contact-page',
    'server/legal-page',
  ],
  'staff-admin': [
    'backend-config',
    'booking-styles',
    'booking-validation',
    'calendar',
    'configuration',
    'design',
    'dialog',
    'lazy-surface',
    'localization',
    'paint-viewport',
    'pole-logo',
    'scheduling-time',
    'site-chrome',
    'turnstile',
  ],
  backend: [
    'business',
    'route-metadata',
    'server/accept',
    'server/agent-content',
    'server/contact-page',
    'server/legal-page',
    'server/theme-script',
  ],
}

export function walkFiles(root, directory) {
  if (!existsSync(resolve(root, directory))) return []
  return readdirSync(resolve(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) throw new Error(`Unsupported source symlink: ${path}`)
      return entry.isDirectory() ? walkFiles(root, path) : [path]
    })
    .sort()
}

export function dependenciesOf(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const dependencies = []
  const unsupported = []
  for (const diagnostic of source.parseDiagnostics)
    unsupported.push(
      `${path}: parser error ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    )
  const add = (node, kind) => {
    if (node && ts.isStringLiteralLike(node)) dependencies.push({ specifier: node.text, kind })
    else unsupported.push(`${path}: nonliteral ${kind}`)
  }
  const isImportMeta = (node) =>
    node && ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier, 'module')
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, 'require')
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, 'type')
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node.arguments[0], 'dynamic import')
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isImportMeta(node.expression.expression)
    ) {
      unsupported.push(
        `${path}: unsupported import.meta dependency operation ${node.expression.name.text}`,
      )
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.[1] &&
      ts.isPropertyAccessExpression(node.arguments[1]) &&
      node.arguments[1].name.text === 'url' &&
      isImportMeta(node.arguments[1].expression)
    ) {
      add(node.arguments[0], 'asset/worker URL')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { dependencies, unsupported }
}

export function inspectBoundaries(root = repositoryRoot) {
  root = realpathSync(root)
  const errors = []
  const unsupported = []
  const manifests = {}
  const exports = new Map()
  const names = new Map()
  for (const [id, directory] of Object.entries(modulePaths)) {
    const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8'))
    manifests[id] = manifest
    if (manifest.name !== `@bladeblend/${id}`) errors.push(`Unexpected package name: ${directory}`)
    names.set(manifest.name, id)
    for (const [key, target] of Object.entries(manifest.exports ?? {})) {
      if (
        !key.startsWith('./') ||
        key.includes('*') ||
        typeof target !== 'string' ||
        !target.startsWith('./') ||
        target.includes('*')
      ) {
        errors.push(`${id}: exports must name explicit source files (${key})`)
        continue
      }
      const absolute = resolve(root, directory, target)
      if (!absolute.startsWith(`${resolve(root, directory)}/`) || !existsSync(absolute)) {
        errors.push(`${id}: missing or escaping export ${key}`)
        continue
      }
      exports.set(`${manifest.name}${key.slice(1)}`, relative(root, realpathSync(absolute)))
    }
  }
  for (const [id, manifest] of Object.entries(manifests)) {
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (names.has(dependency) && !allowedDependencies[id].includes(names.get(dependency)))
        errors.push(`${id}: forbidden declared dependency ${dependency}`)
    }
  }
  const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const directories = [
    'src',
    ...Object.entries(modulePaths).flatMap(([id, path]) =>
      id === 'backend' ? [`${path}/functions`, `${path}/worker`] : [`${path}/src`],
    ),
  ]
  const files = directories
    .flatMap((path) => walkFiles(root, path))
    .filter((path) => /\.(?:[cm]?[jt]sx?)$/.test(path))
  const edges = []
  const compilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.ReactJSX,
  }
  const exportedTargets = new Set(exports.values())
  // Harnesses may intentionally inspect private source. Record their literal dependencies for
  // audited behavioral cohorts, without applying production package restrictions to tests.
  const testEdges = []
  for (const file of ['tools/e2e', 'tests/unit', 'tests/integration']
    .flatMap((path) => walkFiles(root, path))
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path))) {
    for (const { specifier } of dependenciesOf(file, readFileSync(resolve(root, file), 'utf8'))
      .dependencies) {
      const normalized = specifier.startsWith('/') ? resolve(root, specifier.slice(1)) : specifier
      const resolved = ts.resolveModuleName(
        normalized,
        resolve(root, file),
        compilerOptions,
        ts.sys,
      ).resolvedModule
      const target =
        exports.get(specifier) ??
        (resolved ? relative(root, realpathSync(resolved.resolvedFileName)) : null)
      if (target && ownerOf(target)) testEdges.push({ from: file, to: target })
    }
  }
  for (const file of files) {
    const owner = ownerOf(file)
    const manifest = manifests[owner] ?? rootManifest
    const parsed = dependenciesOf(file, readFileSync(resolve(root, file), 'utf8'))
    unsupported.push(...parsed.unsupported)
    for (const { specifier, kind } of parsed.dependencies) {
      let target
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      if (names.has(packageName)) {
        target = exports.get(specifier)
        if (!target) errors.push(`${file}: private or missing package export ${specifier}`)
        if (!manifest.dependencies?.[packageName])
          errors.push(`${file}: undeclared dependency ${packageName}`)
        if (
          packageName === '@bladeblend/public-web' &&
          owner &&
          owner !== 'public-web' &&
          !publicInterfaces[owner]?.includes(specifier.slice(packageName.length + 1))
        )
          errors.push(`${file}: public interface not permitted for ${owner}: ${specifier}`)
      } else if (specifier.startsWith('.')) {
        const literal = resolve(root, dirname(file), specifier.replace(/\?(?:raw|url)$/, ''))
        const resolved = ts.resolveModuleName(
          specifier,
          resolve(root, file),
          compilerOptions,
          ts.sys,
        ).resolvedModule
        target = resolved
          ? relative(root, realpathSync(resolved.resolvedFileName))
          : existsSync(literal) && extname(literal)
            ? relative(root, realpathSync(literal))
            : undefined
        if (!target) errors.push(`${file}: unresolved ${kind} ${specifier}`)
        else if (ownerOf(target) !== owner && !target.startsWith('public/')) {
          // Deno deploys source, not npm workspace links. Portable contract modules participate
          // in that same closure; the exception still requires the exact public export target.
          const denoSource = file.startsWith('supabase/functions/') || file.startsWith('packages/')
          if (!denoSource || !specifier.endsWith('.ts') || !exportedTargets.has(target))
            errors.push(`${file}: cross-package relative import ${specifier}`)
          if (!manifest.dependencies?.[`@bladeblend/${ownerOf(target)}`])
            errors.push(`${file}: undeclared relative package dependency ${specifier}`)
        }
      } else {
        const deno = file.startsWith('supabase/functions/')
        const remote = /^(?:https?:|npm:)/.test(specifier)
        if (remote && !deno) errors.push(`${file}: remote import outside Deno ${specifier}`)
        else if (remote) {
          // Remote versions/import maps are checked by the existing Deno CI job. They are never
          // inferred as browser edges, and changes to maps/lockfiles select full verification.
          continue
        } else if (specifier === 'cloudflare:workers' && file.startsWith('supabase/worker/'))
          continue
        else if (specifier.startsWith('node:')) {
          if (owner !== 'backend')
            errors.push(`${file}: browser imports server builtin ${specifier}`)
        } else {
          if (!manifest.dependencies?.[packageName])
            errors.push(`${file}: undeclared external dependency ${packageName}`)
          let resolved = ts.resolveModuleName(
            specifier,
            resolve(root, file),
            compilerOptions,
            ts.sys,
          ).resolvedModule
          if (!resolved && /\.(css|wasm)$/.test(specifier)) {
            try {
              resolved = createRequire(resolve(root, file)).resolve(specifier)
            } catch {
              /* diagnostic below */
            }
          }
          if (!resolved) errors.push(`${file}: unresolved external import ${specifier}`)
        }
      }
      if (!target) continue
      if (target.startsWith('../'))
        errors.push(`${file}: dependency escapes repository ${specifier}`)
      const provider = ownerOf(target)
      if (target.startsWith('public/') && /\.[cm]?[jt]sx?$/.test(target))
        errors.push(`${file}: module imports unowned public executable ${target}`)
      if (
        provider === 'public-web' &&
        owner &&
        owner !== provider &&
        !publicInterfaces[owner]?.some(
          (name) => exports.get(`@bladeblend/public-web/${name}`) === target,
        )
      )
        errors.push(`${file}: public target not permitted for ${owner}: ${target}`)
      if (owner && provider && owner !== provider && !allowedDependencies[owner].includes(provider))
        errors.push(`${file}: forbidden dependency ${owner} -> ${provider}`)
      if (owner && !provider && !target.startsWith('public/'))
        errors.push(`${file}: module imports root implementation ${target}`)
      edges.push({ from: file, to: target, kind })
    }
  }
  return {
    files: files.sort(),
    testEdges: testEdges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
    edges: edges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
    errors: [...new Set(errors)].sort(),
    unsupported: [...new Set(unsupported)].sort(),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectBoundaries()
  if (result.errors.length || result.unsupported.length) {
    console.error([...result.errors, ...result.unsupported].join('\n'))
    process.exitCode = 1
  } else
    console.log(
      `Module boundaries: ${result.files.length} source files, ${result.edges.length} resolved local edges`,
    )
}
