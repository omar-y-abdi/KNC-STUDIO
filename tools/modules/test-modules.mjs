import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { dependenciesOf, inspectBoundaries, modulePaths } from './boundaries.mjs'
import { commandsFor, modulePlan } from './run.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bladeblend-modules-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const json = (path, value) => write(path, JSON.stringify(value))
  const dependencies = Object.fromEntries(
    Object.keys(modulePaths).map((id) => [`@bladeblend/${id}`, '*']),
  )
  json('package.json', { name: 'root', private: true, dependencies })
  for (const [id, path] of Object.entries(modulePaths)) {
    const source = id === 'backend' ? 'worker/index.ts' : 'src/index.ts'
    json(`${path}/package.json`, {
      name: `@bladeblend/${id}`,
      exports: { './entry': `./${source}` },
      dependencies: {},
    })
    write(`${path}/${source}`, 'export const value = 1\n')
  }
  return { root, write, json }
}

test('TypeScript syntax analysis ignores strings/comments and captures every dependency form', () => {
  const result = dependenciesOf(
    'a.ts',
    `
    // import 'fake-one'
    const text = "import('fake-two')";
    import type { A } from './types'; export { B } from './export';
    const x = import('./lazy'); type T = import('./shape').T;
    import y = require('./legacy'); require('./runtime');
    new Worker(new URL('./worker.ts', import . meta . url));
    import(name); import.meta.glob('./**/*.ts');
    import.meta.resolve('./resolved'); import.meta.resolve(name);
  `,
  )
  assert.deepEqual(
    result.dependencies.map((entry) => entry.specifier),
    [
      './types',
      './export',
      './lazy',
      './shape',
      './legacy',
      './runtime',
      './worker.ts',
      './resolved',
    ],
  )
  assert.deepEqual(result.unsupported, [
    'a.ts: nonliteral dynamic import',
    'a.ts: unsupported import.meta dependency operation glob',
    'a.ts: nonliteral import.meta.resolve',
  ])
})

test('boundaries reject private/undeclared/forbidden production imports and missing workers', (t) => {
  const f = fixture(t)
  f.write(
    'modules/studio/src/index.ts',
    `import '../../public-web/src/index.ts'; import '@bladeblend/public-web/private'; new Worker(new URL('./missing.ts', import.meta.url));`,
  )
  const result = inspectBoundaries(f.root)
  assert.ok(result.errors.some((error) => error.includes('cross-package relative')))
  assert.ok(result.errors.some((error) => error.includes('private or missing package export')))
  assert.ok(result.errors.some((error) => error.includes('undeclared dependency')))
  assert.ok(result.errors.some((error) => error.includes('unresolved asset/worker URL')))
  f.write('modules/public-web/src/index.ts', `export * from '@bladeblend/backend/entry'`)
  assert.ok(
    inspectBoundaries(f.root).errors.some((error) =>
      error.includes('forbidden dependency public-web -> backend'),
    ),
  )
})

test('Studio cannot regain the public App or source-preview runtime through public exports', (t) => {
  const f = fixture(t)
  f.json('modules/public-web/package.json', {
    name: '@bladeblend/public-web',
    exports: { './app': './src/index.ts', './preview-runtime': './src/index.ts' },
    dependencies: {},
  })
  f.json('modules/studio/package.json', {
    name: '@bladeblend/studio',
    exports: { './entry': './src/index.ts' },
    dependencies: { '@bladeblend/public-web': '*' },
  })
  f.write(
    'modules/studio/src/index.ts',
    `import '@bladeblend/public-web/app'; import('@bladeblend/public-web/preview-runtime')`,
  )
  assert.equal(
    inspectBoundaries(f.root).errors.filter((error) =>
      error.includes('public interface not permitted'),
    ).length,
    2,
  )
})

test('Deno may target only declared exact portable exports, including transitive contracts', (t) => {
  const f = fixture(t)
  f.json('supabase/package.json', {
    name: '@bladeblend/backend',
    exports: { './worker': './worker/index.ts' },
    dependencies: { '@bladeblend/content-contracts': '*' },
  })
  f.write(
    'supabase/functions/example/index.ts',
    `import '../../../packages/content-contracts/src/index.ts'`,
  )
  assert.deepEqual(inspectBoundaries(f.root).errors, [])
  f.write('packages/content-contracts/src/private.ts', 'export const secret = 1')
  f.write(
    'supabase/functions/example/index.ts',
    `import '../../../packages/content-contracts/src/private.ts'`,
  )
  assert.ok(
    inspectBoundaries(f.root).errors.some((error) => error.includes('cross-package relative')),
  )
})

test('wildcard exports and browser server builtins fail boundary enforcement', (t) => {
  const f = fixture(t)
  f.json('modules/studio/package.json', {
    name: '@bladeblend/studio',
    exports: { './*': './src/*' },
    dependencies: {},
  })
  f.write('modules/studio/src/index.ts', `import fs from 'node:fs'`)
  const result = inspectBoundaries(f.root)
  assert.ok(result.errors.some((error) => error.includes('explicit source files')))
  assert.ok(result.errors.some((error) => error.includes('browser imports server builtin')))
  f.write('src/index.ts', `import '@bladeblend/backend/entry'`)
  assert.ok(
    inspectBoundaries(f.root).errors.some((error) =>
      error.includes('browser composition imports backend'),
    ),
  )
})

test('backend local commands check real Deno entrypoints and package Worker without deployment', () => {
  const typecheck = commandsFor('backend', 'typecheck')
  const edge = typecheck.filter(({ executable }) => executable === 'deno')
  assert.ok(edge.length > 0)
  assert.ok(
    edge.every(
      ({ cwd, args }) =>
        cwd === 'supabase/functions' &&
        JSON.stringify(args.slice(0, 4)) ===
          JSON.stringify(['check', '--config', 'deno.json', '--frozen']) &&
        /^\.\/[^/]+\/index\.ts$/.test(args[4]),
    ),
  )
  const build = commandsFor('backend', 'build')
  assert.deepEqual(build.at(-1).args.slice(-2), ['deploy', '--dry-run'])
  assert.deepEqual(commandsFor('backend', 'lint')[0].args.slice(-1), ['supabase/worker'])
  assert.deepEqual(commandsFor('backend', 'database')[0].args.slice(-2), ['test', 'db'])
})

test('workspace tests run the whole native unit suite and the plan previews the CI jobs', () => {
  for (const id of Object.keys(modulePaths)) {
    assert.deepEqual(commandsFor(id, 'test'), [
      { executable: process.execPath, args: ['node_modules/vitest/vitest.mjs', 'run'] },
    ])
    const omitted = Object.entries(modulePlan(id).jobs)
      .filter(([, job]) => !job.required)
      .map(([job]) => job)
    assert.deepEqual(
      omitted,
      ['studio', 'staff-admin'].includes(id) ? ['edge-functions', 'database-current'] : [],
      id,
    )
  }
})

test('the workspace runner prints the whole browser group for a dry run', () => {
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, ['tools/modules/run.mjs', ...args, '--dry-run'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )
  assert.deepEqual(run('studio', 'browser'), {
    env: { E2E_GROUP: 'cms' },
    args: ['node_modules/playwright/cli.js', 'test'],
  })
  assert.equal(run('backend', 'browser').env.E2E_GROUP, 'customer')
  assert.equal(run('staff-admin', 'browser').env.E2E_GROUP, 'public')
  assert.throws(() => run('unknown', 'test'), /Unknown module/)
})

test('CSS parser enforces private cross-module imports and encoded resource paths', (t) => {
  const f = fixture(t)
  f.write('modules/staff-admin/src/AdminShell.css', '.staff {color:red}')
  for (const source of [
    '@import "../../staff-admin/src/AdminShell.css";',
    '@IMPORT url("../../staff-admin/src/AdminShell.css");',
    '@import "..\\2f ..\\2f staff-admin/src/AdminShell.css";',
    '@import "%2e%2e/%2e%2e/staff-admin/src/AdminShell.css";',
    '@import url(/modules/staff-admin/src/AdminShell.css);',
    '.x { background: url("../../staff-admin/src/AdminShell.css") }',
    '.x { background: u\\72l("../../staff-admin/src/AdminShell.css") }',
    '.x { background: image-set("../../staff-admin/src/AdminShell.css" 1x) }',
    '@\\69mport "../../staff-admin/src/AdminShell.css";',
  ]) {
    f.write('modules/studio/src/studio.css', source)
    assert.ok(
      inspectBoundaries(f.root).errors.some((error) => error.includes('cross-package CSS')),
      source,
    )
  }
})

test('CSS preserves owned styles and public fonts while rejecting opaque or malformed dependencies', (t) => {
  const f = fixture(t)
  f.write('public/fonts/example.woff2', 'font bytes')
  f.write('public/tokens.css', ':root {--color: red}')
  f.write('modules/studio/src/local.css', '.local {color: var(--color)}')
  f.write(
    'modules/studio/src/studio.css',
    '@import "./local.css"; @import "../../../public/tokens.css"; @font-face {font-family: Example; src: url("/fonts/example.woff2")} .icon {filter: url(#filter)}',
  )
  const graph = inspectBoundaries(f.root)
  assert.deepEqual([...graph.errors, ...graph.unsupported], [])
  for (const target of [
    'modules/studio/src/local.css',
    'public/tokens.css',
    'public/fonts/example.woff2',
  ])
    assert.ok(graph.edges.some(({ from, to }) => from.endsWith('/studio.css') && to === target))
  for (const css of [
    '@import "https://example.invalid/private.css";',
    '@import "data:text/css,.x{}";',
    '.x{background:url("%zz")}',
    '@import var(--private);',
  ]) {
    f.write('modules/studio/src/studio.css', css)
    const invalid = inspectBoundaries(f.root)
    assert.ok(invalid.errors.length + invalid.unsupported.length > 0, css)
  }
})
