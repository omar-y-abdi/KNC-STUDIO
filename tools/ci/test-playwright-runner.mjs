import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import {
  discoverBrowserFiles,
  discoverUnitFiles,
  testFiles,
  verifyRunnerFiles,
} from './verify-test-inventory.mjs'

const cli = resolve('node_modules/playwright/cli.js')
const runner = pathToFileURL(resolve('node_modules/@playwright/test/index.mjs')).href
test('native runner makes fixture failure, timeout, focused tests and empty selection fatal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knc-native-runner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, 'playwright.config.mjs')
  const report = join(root, 'results.json')
  await writeFile(
    config,
    `export default {testDir:${JSON.stringify(root)},testMatch:'*.spec.mjs',forbidOnly:true,retries:0,workers:1,timeout:150,reporter:[['json',{outputFile:${JSON.stringify(report)}}]]}`,
  )
  const spec = join(root, 'failure.spec.mjs')
  await writeFile(
    spec,
    `import {test as base} from ${JSON.stringify(runner)};
    const test=base.extend({gate:async({},use)=>{throw new Error('fixture failure');await use()}});
    test('setup fails',async({gate})=>{});
    test('hang',async()=>await new Promise(()=>{}));
    test('next case still runs',async()=>{});
  `,
  )
  const run = (...args) =>
    spawnSync(process.execPath, [cli, 'test', '--config', config, ...args], {
      encoding: 'utf8',
      timeout: 30000,
    })
  assert.equal(run().status, 1)
  const data = JSON.parse(await readFile(report, 'utf8'))
  assert.equal(data.stats.unexpected, 2)
  assert.equal(data.stats.expected, 1)
  assert.equal(data.stats.skipped, 0)
  assert.equal(run('--grep', 'missing-case').status, 1)
  await writeFile(
    spec,
    `import {test} from ${JSON.stringify(runner)};test.only('focused',async()=>{});`,
  )
  const focused = run()
  assert.equal(focused.status, 1)
  assert.match(focused.stdout + focused.stderr, /forbidOnly/)
})

test('native CMS shards cover every case exactly once', () => {
  // `specs` collects each listed case's project, file (relative to testDir) and spec identity.
  const list = (args, specs = []) => {
    const result = spawnSync(
      process.execPath,
      [cli, 'test', '--list', '--reporter=json', ...args],
      { env: { ...process.env, E2E_GROUP: 'cms' }, encoding: 'utf8', timeout: 30000 },
    )
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    const cases = []
    const visit = (suite) => {
      for (const spec of suite.specs ?? [])
        for (const row of spec.tests ?? []) {
          cases.push(`${spec.id}/${row.projectName}`)
          // A test id includes its project, so the engines share only location and title.
          const key = `${spec.file}:${spec.line}:${spec.column}:${spec.title}`
          specs.push({ project: row.projectName, file: spec.file, key })
        }
      for (const child of suite.suites ?? []) visit(child)
    }
    for (const suite of report.suites) visit(suite)
    if (args.some((arg) => arg.startsWith('--shard=')))
      assert.ok(cases.length > 0, 'Empty selected shard')
    return cases.sort()
  }
  const specs = []
  list([], specs)
  const chromium = specs.filter((spec) => spec.project === 'cms-chromium')
  // No spec file leaves the group unnoticed through a testMatch or testIgnore change.
  assert.deepEqual(
    [...new Set(chromium.map((spec) => spec.file))].sort(),
    readdirSync('tools/e2e')
      .filter((name) => /^cms-.*\.spec\.mjs$/.test(name) && name !== 'cms-startup.spec.mjs')
      .sort(),
  )
  // WebKit lists every Chromium case except those of *.chromium.spec.mjs files.
  const webkit = specs.filter((spec) => spec.project === 'cms-webkit')
  const shared = chromium.filter((spec) => !spec.file.endsWith('.chromium.spec.mjs'))
  assert.deepEqual(webkit.map((spec) => spec.key).sort(), shared.map((spec) => spec.key).sort())
  // Check the actual workflow selector and matrix against the native shard IDs.
  const { load } = createRequire(import.meta.url)('js-yaml')
  const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const cms = workflow.jobs.cms
  const { matrix } = cms.strategy
  assert.deepEqual(matrix, { engine: ['chromium', 'webkit'], shard: [1, 2, 3, 4, 5, 6, 7, 8, 9] })
  const steps = cms.steps.filter((step) =>
    step.run?.startsWith('node tools/ci/impact-plan.mjs browser cms '),
  )
  assert.equal(steps.length, 2)
  const args =
    'node tools/ci/impact-plan.mjs browser cms --project=cms-${{ matrix.engine }} --shard=${{ matrix.shard }}/9'
  assert.equal(steps[0].run, `${args} --list --reporter=json > .ci-expected.json`)
  assert.equal(steps[1].run, args)
  for (const engine of matrix.engine) {
    const project = `cms-${engine}`
    const selected = specs
      .filter((spec) => spec.project === project)
      .map((spec) => `${project}:${spec.key}`)
      .sort()
    assert.ok(selected.length > 0)
    const assignedSpecs = []
    const assigned = matrix.shard.flatMap((shard) =>
      list([`--project=${project}`, `--shard=${shard}/9`], assignedSpecs),
    )
    assert.equal(new Set(assigned).size, assigned.length, `${project}: duplicate cases`)
    assert.deepEqual(
      assignedSpecs.map((spec) => `${spec.project}:${spec.key}`).sort(),
      selected,
      `${project}: missing or unexpected cases`,
    )
  }
})

async function nativeInventoryFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'knc-native-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'tools/e2e'), { recursive: true })
  mkdirSync(join(root, 'tests/unit'), { recursive: true })
  for (const file of ['playwright.config.ts', 'vitest.config.ts', 'tools/e2e/origins.mjs'])
    cpSync(file, join(root, file))
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'))
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0)
  const spec = (name, content = `import {test} from '@playwright/test'; test('${name}',()=>{});`) =>
    writeFileSync(join(root, `tools/e2e/${name}.spec.mjs`), content)
  for (const name of ['admin-state', 'cms-fixture', 'cms-startup', 'customer']) spec(name)
  writeFileSync(
    join(root, 'tests/unit/example.test.ts'),
    "import {test} from 'vitest'; test('example',()=>{});",
  )
  return { root, spec }
}

test('native inventory accepts a fixture whose every test file is discovered', async (t) => {
  const { root } = await nativeInventoryFixture(t)
  const files = testFiles(root)
  assert.deepEqual(files, [
    'tests/unit/example.test.ts',
    'tools/e2e/admin-state.spec.mjs',
    'tools/e2e/cms-fixture.spec.mjs',
    'tools/e2e/cms-startup.spec.mjs',
    'tools/e2e/customer.spec.mjs',
  ])
  for (const group of ['cms', 'public', 'startup', 'customer'])
    verifyRunnerFiles(files, group, discoverBrowserFiles(root, group))
  verifyRunnerFiles(files, 'unit', discoverUnitFiles(root))
})

test('native inventory rejects a public spec excluded by project testMatch', async (t) => {
  const { root, spec } = await nativeInventoryFixture(t)
  spec('new-public-contract')
  const discovered = discoverBrowserFiles(root, 'public')
  assert.deepEqual(discovered, ['tools/e2e/admin-state.spec.mjs'])
  assert.throws(() => verifyRunnerFiles(testFiles(root), 'public', discovered), /public.*on disk/)
})

test('native inventory rejects an empty browser spec', async (t) => {
  const { root, spec } = await nativeInventoryFixture(t)
  spec('cms-empty', 'export {}\n')
  assert.throws(
    () => verifyRunnerFiles(testFiles(root), 'cms', discoverBrowserFiles(root, 'cms')),
    /cms.*on disk/,
  )
})

test('native inventory rejects a unit test file the unit runner does not include', async (t) => {
  const { root } = await nativeInventoryFixture(t)
  writeFileSync(
    join(root, 'tests/unit/excluded.test.tsx'),
    "import {test} from 'vitest'; test('excluded',()=>{});",
  )
  const discovered = discoverUnitFiles(root)
  assert.deepEqual(discovered, ['tests/unit/example.test.ts'])
  assert.throws(() => verifyRunnerFiles(testFiles(root), 'unit', discovered), /unit.*on disk/)
})

test('every browser and unit test file on disk is independently discovered by its native runner', () => {
  const files = testFiles(process.cwd())
  for (const group of ['cms', 'public', 'startup', 'customer'])
    verifyRunnerFiles(files, group, discoverBrowserFiles(process.cwd(), group))
  verifyRunnerFiles(files, 'unit', discoverUnitFiles(process.cwd()))
})
