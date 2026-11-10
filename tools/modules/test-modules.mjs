import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { dependenciesOf, inspectBoundaries, modulePaths, repositoryRoot } from './boundaries.mjs'
import { createPlan, verifyPlan, authorizeOmission, validatePlan } from './impact.mjs'
import {
  git,
  loadInventory,
  moduleIds,
  selectVerification,
  unitOwnership,
  deliveryCohort,
} from './model.mjs'
import { browserArguments, commandsFor } from './run.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bladeblend-modules-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const json = (path, value) => write(path, JSON.stringify(value))
  const dependencies = Object.fromEntries(moduleIds.map((id) => [`@bladeblend/${id}`, '*']))
  json('package.json', { name: 'root', private: true, dependencies })
  const inventory = {}
  for (const [id, path] of Object.entries(modulePaths)) {
    const source = id === 'backend' ? 'worker/index.ts' : 'src/index.ts'
    json(`${path}/package.json`, {
      name: `@bladeblend/${id}`,
      exports: { './entry': `./${source}` },
      dependencies: {},
    })
    write(`${path}/${source}`, 'export const value = 1\n')
    const testPath = `tests/unit/${id}.test.ts`
    write(testPath, `import '../../${path}/${source}'`)
    inventory[testPath] = { kind: 'unit', owners: [id], reason: 'Fixture direct source contract' }
  }
  for (const kind of ['cms', 'startup', 'public', 'customer', 'integration']) {
    const path =
      kind === 'integration' ? 'tests/integration/backend.test.ts' : `tools/e2e/${kind}.spec.mjs`
    write(path, '')
    inventory[path] = {
      kind,
      owners: kind === 'public' ? ['public-web', 'staff-admin'] : moduleIds,
      reason: 'Fixture runtime cohort',
    }
  }
  json('tools/modules/test-ownership.json', inventory)
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'module-fixture@example.invalid'])
  git(root, ['config', 'user.name', 'Module fixture'])
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'baseline'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const context = { root, base: head, head, event: 'pull_request' }
  return { root, write, json, inventory, context }
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
  `,
  )
  assert.deepEqual(
    result.dependencies.map((entry) => entry.specifier),
    ['./types', './export', './lazy', './shape', './legacy', './runtime', './worker.ts'],
  )
  assert.equal(result.unsupported.length, 2)
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

test('isolated Studio edit selects its units and full Studio cohort while omitting unrelated jobs', (t) => {
  const f = fixture(t)
  f.write('modules/studio/src/index.ts', 'export const value = 2\n')
  const plan = createPlan(f.context)
  assert.equal(plan.mode, 'affected')
  assert.deepEqual(plan.affected, ['studio'])
  assert.deepEqual(plan.tests.unit, ['tests/unit/studio.test.ts'])
  assert.equal(plan.jobs.cms.required, true)
  assert.equal(plan.jobs.startup.required, true)
  assert.equal(plan.jobs['public-browsers'].required, false)
  assert.equal(plan.jobs['database-current'].required, false)
  assert.deepEqual(createPlan(f.context), plan)
  authorizeOmission(plan, 'database-current', f.context)
  assert.throws(() => authorizeOmission(plan, 'cms', f.context), /Required job/)
})

test('content format, SQL, CSS and wire contracts select all current consumers', (t) => {
  const graph = { edges: [] }
  const inventory = {
    'a.test.ts': { kind: 'unit', owners: moduleIds },
    'public.spec.mjs': { kind: 'public', owners: moduleIds },
  }
  const units = [{ path: 'a.test.ts', owners: moduleIds }]
  for (const path of [
    'packages/content-contracts/src/cms.ts',
    'packages/backend-contracts/src/rpcSchemas.ts',
    'supabase/migrations/001.sql',
    'public/tokens.css',
  ]) {
    const plan = selectVerification([{ path, status: 'M' }], graph, inventory, units)
    for (const job of ['cms', 'public-browsers', 'edge-functions', 'database-current', 'startup'])
      assert.equal(plan.jobs[job].required, true, `${path}: ${job}`)
  }
  assert.ok(t)
})

test('staff auth selects staff/public browser behavior and Studio owner gate', (t) => {
  const f = fixture(t)
  f.write('modules/staff-admin/src/index.ts', 'export const value = 2')
  const plan = createPlan(f.context)
  assert.deepEqual(plan.affected, ['staff-admin', 'studio'])
  assert.equal(plan.jobs['public-browsers'].required, true)
  assert.equal(plan.jobs.cms.required, true)
  assert.equal(plan.jobs['database-current'].required, false)
})

test('unknown, additions, deletions, package changes, config, missing base and non-PR events fail closed', (t) => {
  const f = fixture(t)
  const graph = inspectBoundaries(f.root)
  const units = unitOwnership(f.root, f.inventory, graph)
  for (const change of [
    { path: 'unknown.txt', status: 'M' },
    { path: 'modules/studio/src/new.ts', status: 'A' },
    { path: 'modules/studio/src/index.ts', status: 'D' },
    { path: 'modules/studio/package.json', status: 'M' },
    { path: 'vite.config.ts', status: 'M' },
    { path: 'tools/e2e/admin-harness.tsx', status: 'M' },
    { path: 'modules/studio/src/rename.ts', status: 'R100' },
    { path: 'package-lock.json', status: 'M' },
  ])
    assert.ok(
      Object.values(selectVerification([change], graph, f.inventory, units).jobs).every(
        (job) => job.required,
      ),
    )
  assert.equal(createPlan({ ...f.context, base: 'missing' }).mode, 'full')
  assert.equal(createPlan({ ...f.context, event: 'push' }).mode, 'full')
  assert.equal(createPlan({ ...f.context, event: 'workflow_dispatch' }).mode, 'full')
  f.write('tests/unit/new.test.ts', '')
  assert.ok(createPlan(f.context).reasons.some((reason) => reason.includes('Unclassified test')))
  assert.ok(createPlan(f.context).tests.unit.includes('tests/unit/new.test.ts'))
})

test('plans bind formatted tracked content, trusted base/head/event and every omission', (t) => {
  const f = fixture(t)
  f.write('modules/studio/src/index.ts', 'export const value = 2\n')
  const plan = createPlan(f.context)
  assert.deepEqual(plan.changes, [{ path: 'modules/studio/src/index.ts', status: 'M' }])
  const corrupted = globalThis.structuredClone(plan)
  corrupted.jobs.cms.required = false
  corrupted.tests.browser.cms = []
  corrupted.shards.cms = 0
  assert.throws(() => verifyPlan(corrupted, f.context), /differs/)
  assert.throws(() => verifyPlan(plan, { ...f.context, event: 'push' }), /differs/)
  assert.throws(() => verifyPlan(plan, { ...f.context, base: 'f'.repeat(40) }), /differs/)
  assert.throws(() => verifyPlan(plan), /Trusted/)
  f.write('modules/studio/src/index.ts', 'export const value = 3\n')
  assert.throws(() => verifyPlan(plan, f.context), /differs/)
  assert.notEqual(plan.source.tree, createPlan(f.context).source.tree)
  f.write('untracked.ts', '')
  assert.equal(createPlan(f.context).mode, 'full')
  const empty = globalThis.structuredClone(plan)
  empty.tests.unit = []
  assert.throws(() => validatePlan(empty), /Empty unit/)
})

test('filesystem test contracts stay always-on; import closures and declared ownership both matter', (t) => {
  const f = fixture(t)
  f.write(
    'tests/unit/public-web.test.ts',
    `import {readFileSync} from 'node:fs'; readFileSync('modules/studio/src/index.ts')`,
  )
  const units = unitOwnership(f.root, f.inventory, inspectBoundaries(f.root))
  assert.deepEqual(
    units.find((entry) => entry.path.endsWith('/public-web.test.ts')).owners,
    moduleIds,
  )
  f.write('modules/studio/src/index.ts', 'export const value = 2')
  assert.ok(createPlan(f.context).tests.unit.includes('tests/unit/public-web.test.ts'))
})

test('repository ownership is complete, boundaries resolve, and local commands select actual tests', () => {
  const { inventory, errors } = loadInventory(repositoryRoot)
  assert.deepEqual(errors, [])
  const graph = inspectBoundaries(repositoryRoot)
  assert.deepEqual([...graph.errors, ...graph.unsupported], [])
  const units = unitOwnership(repositoryRoot, inventory, graph)
  const plan = selectVerification(
    [{ path: 'modules/studio/src/WorkspaceView.tsx', status: 'M' }],
    graph,
    inventory,
    units,
  )
  assert.ok(plan.tests.unit.length > 0 && plan.tests.unit.length < units.length)
  const required = [
    'cms-workspace-views',
    'cms-workspace-edge',
    'cms-layout-provenance',
    'cms-draft-resources',
    'cms-context-latency',
    'cms-owner',
    'cms-responsive',
  ]
  for (const name of required)
    assert.ok(plan.tests.browser.cms.includes(`tools/e2e/${name}.spec.mjs`))
  assert.equal(
    plan.tests.browser.cms.length,
    Object.values(inventory).filter((entry) => entry.kind === 'cms').length,
  )
  assert.equal(plan.jobs['database-current'].required, false)
  assert.deepEqual(plan.tests.browser.public, [
    'tools/e2e/admin-shared.spec.mjs',
    'tools/e2e/admin-state.spec.mjs',
  ])
  const command = commandsFor('studio', 'test', plan)[0]
  assert.deepEqual(command.args.slice(2), plan.tests.unit)
  const result = spawnSync(
    process.execPath,
    browserArguments(plan.tests.browser.cms, [
      '--project=cms-chromium',
      '--list',
      '--reporter=json',
    ]),
    {
      cwd: repositoryRoot,
      env: { ...process.env, E2E_GROUP: 'cms' },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  const found = new Set()
  let cases = 0
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      found.add(`tools/e2e/${spec.file}`)
      cases += spec.tests.length
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  report.suites.forEach(visit)
  assert.ok(cases > 0)
  assert.deepEqual([...found].sort(), plan.tests.browser.cms)
})

test('browser selection forbids empty or injected filters and escapes native regex arguments', () => {
  assert.throws(() => browserArguments([]), /Empty/)
  assert.throws(() => browserArguments(['--pass-with-no-tests']), /Invalid/)
  assert.deepEqual(browserArguments(['tools/e2e/cms-owner.spec.mjs']), [
    'node_modules/playwright/cli.js',
    'test',
    'tools/e2e/cms-owner\\.spec\\.mjs$',
  ])
})

test('audited delivery panel narrows browsers only while its exact callers and sole changed input remain', () => {
  const { inventory } = loadInventory(repositoryRoot)
  const graph = inspectBoundaries(repositoryRoot)
  const units = unitOwnership(repositoryRoot, inventory, graph)
  const change = { path: deliveryCohort.input, status: 'M' }
  const select = (changes = [change], currentGraph = graph) =>
    selectVerification(changes, currentGraph, inventory, units)
  const plan = select()
  assert.deepEqual(plan.tests.browser.cms, deliveryCohort.cms)
  assert.deepEqual(plan.tests.browser.public, deliveryCohort.public)
  assert.equal(plan.shards.cms, 1)
  assert.equal(plan.shards.public, 1)
  assert.equal(plan.jobs['database-current'].required, false)
  assert.ok(plan.reasons.some((reason) => reason.includes('Audited DeliveryStatus leaf')))
  for (const { file } of graph.testUnsupported) {
    assert.ok(file.startsWith('tests/unit/'), 'Unknown browser consumers must prevent narrowing')
    assert.ok(plan.tests.unit.includes(file), `Unknown unit inputs stay always-on: ${file}`)
  }
  for (const path of [
    'modules/studio/src/DomainPanels.tsx',
    'modules/studio/src/studio.css',
    'packages/content-contracts/src/cms.ts',
  ]) {
    assert.ok(
      select([change, { path, status: 'M' }]).tests.browser.cms.length > deliveryCohort.cms.length,
    )
  }
  const widened = {
    ...graph,
    edges: [
      ...graph.edges,
      { from: 'modules/studio/src/AnotherPanel.tsx', to: deliveryCohort.input, kind: 'module' },
    ],
  }
  assert.ok(select([change], widened).tests.browser.cms.length > deliveryCohort.cms.length)
  const harness = {
    ...graph,
    testEdges: [
      ...graph.testEdges,
      { from: 'tools/e2e/another-harness.tsx', to: deliveryCohort.input },
    ],
  }
  assert.ok(select([change], harness).tests.browser.cms.length > deliveryCohort.cms.length)
})

test('backend local commands check real Deno entrypoints and package Worker without deployment', () => {
  const plan = { tests: { unit: ['tests/unit/workerRoutes.test.ts'] } }
  const typecheck = commandsFor('backend', 'typecheck', plan)
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
  const build = commandsFor('backend', 'build', plan)
  assert.deepEqual(build.at(-1).args.slice(-2), ['deploy', '--dry-run'])
  assert.deepEqual(commandsFor('backend', 'lint', plan)[0].args.slice(-1), ['supabase/worker'])
  assert.deepEqual(commandsFor('backend', 'database', plan)[0].args.slice(-2), ['test', 'db'])
})

test('unknown browser consumer already in base disables a later delivery-only cohort', (t) => {
  const f = fixture(t)
  f.write(deliveryCohort.input, 'export const DeliveryStatus = 1')
  f.write(deliveryCohort.consumers[0], "import './DeliveryStatus'")
  f.write(deliveryCohort.consumers[1], "import '/modules/studio/src/DeliveryStatus.tsx'")
  for (const path of [...deliveryCohort.cms, ...deliveryCohort.public]) {
    f.write(
      path,
      path.endsWith('/cms-delivery-status.spec.mjs')
        ? "import '/modules/studio/src/DeliveryStatus.tsx'"
        : '',
    )
    f.inventory[path] = {
      kind: path.includes('/cms-') ? 'cms' : 'public',
      owners: ['studio'],
      reason: 'Audited delivery fixture consumer',
    }
  }
  f.write(
    'tools/e2e/public.spec.mjs',
    "page.evaluate(async path => import(path), '/modules/studio/src/DeliveryStatus.tsx')",
  )
  f.json('tools/modules/test-ownership.json', f.inventory)
  git(f.root, ['add', '.'])
  git(f.root, ['commit', '-qm', 'existing owned runtime consumer'])
  const head = git(f.root, ['rev-parse', 'HEAD'])
  f.write(deliveryCohort.input, 'export const DeliveryStatus = 2')
  const plan = createPlan({ ...f.context, base: head, head })
  assert.equal(plan.mode, 'full')
  assert.ok(plan.tests.browser.public.includes('tools/e2e/public.spec.mjs'))
  assert.ok(Object.values(plan.jobs).every((job) => job.required))
  assert.ok(plan.reasons.some((reason) => reason.includes('incomplete browser consumer graph')))
})

test('unmodeled source formats require full verification, including Studio CSS and templates', (t) => {
  const f = fixture(t)
  const graph = inspectBoundaries(f.root)
  const units = unitOwnership(f.root, f.inventory, graph)
  for (const path of [
    'modules/studio/src/studio.css',
    'modules/studio/src/contact.en.html',
    'modules/studio/src/config.json',
    'modules/studio/src/legacy.txt',
  ]) {
    const plan = selectVerification([{ path, status: 'M' }], graph, f.inventory, units)
    assert.equal(plan.mode, 'full', path)
    assert.ok(
      Object.values(plan.jobs).every((job) => job.required),
      path,
    )
  }
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
