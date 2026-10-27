import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

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

test('native CMS PR and main shards cover the selected cases exactly once', () => {
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
  // Check the actual workflow selector against independently chosen files and native shard IDs.
  const { load } = createRequire(import.meta.url)('js-yaml')
  const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const cms = workflow.jobs.cms
  assert.deepEqual(cms.strategy.matrix, { engine: ['chromium', 'webkit'], shard: [1, 2, 3, 4] })
  const selector = cms.env.CMS_GREP.match(
    /^\$\{\{ matrix.engine == 'webkit' && github.event_name == 'pull_request' && '([^']+)' \|\| '' \}\}$/,
  )
  assert.ok(selector, 'Only PR WebKit may narrow the CMS matrix')
  const mobileFiles = new Set([
    'cms-owner.spec.mjs',
    'cms-mobile.spec.mjs',
    'cms-new-page-mobile.spec.mjs',
    'cms-barber-marquee.spec.mjs',
  ])
  const steps = cms.steps.filter((step) => step.run?.startsWith('npx playwright test '))
  assert.equal(steps.length, 2)
  const args =
    'npx playwright test --project=cms-${{ matrix.engine }} --grep="$CMS_GREP" --shard=${{ matrix.shard }}/4'
  assert.equal(steps[0].name, 'Discover every assigned CMS case')
  assert.equal(steps[0].run, `${args} --list --reporter=json > .ci-expected.json`)
  assert.equal(steps[1].name, 'Exercise the unchanged CMS domain contracts')
  assert.equal(steps[1].run, args)
  // These are the three distinct selections: Chromium is identical for every event, while
  // WebKit has a PR subset and a full push/manual selection. Discover each selection once.
  for (const { engine, mobileOnly } of [
    { engine: 'chromium', mobileOnly: false },
    { engine: 'webkit', mobileOnly: false },
    { engine: 'webkit', mobileOnly: true },
  ]) {
    const project = `cms-${engine}`
    const grep = mobileOnly ? selector[1] : ''
    const selected = specs
      .filter((spec) => spec.project === project && (!mobileOnly || mobileFiles.has(spec.file)))
      .map((spec) => `${project}:${spec.key}`)
      .sort()
    assert.ok(selected.length > 0)
    const assignedSpecs = []
    const assigned = cms.strategy.matrix.shard.flatMap((shard) =>
      list([`--project=${project}`, `--grep=${grep}`, `--shard=${shard}/4`], assignedSpecs),
    )
    assert.equal(
      new Set(assigned).size,
      assigned.length,
      `${project}/${mobileOnly}: duplicate cases`,
    )
    assert.deepEqual(
      assignedSpecs.map((spec) => `${spec.project}:${spec.key}`).sort(),
      selected,
      `${project}/${mobileOnly}: missing or unexpected cases`,
    )
    if (mobileOnly) assert.deepEqual(new Set(assignedSpecs.map((spec) => spec.file)), mobileFiles)
  }
})
