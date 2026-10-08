import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
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

test('native CMS shards cover each case exactly once, with both required engines', () => {
  const list = (args) => {
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
        for (const row of spec.tests ?? []) cases.push(`${spec.id}/${row.projectName}`)
      for (const child of suite.suites ?? []) visit(child)
    }
    for (const suite of report.suites) visit(suite)
    return cases.sort()
  }
  const expected = list([])
  assert.equal(expected.length, 162)
  assert.equal(expected.filter((id) => id.endsWith('/cms-chromium')).length, 81)
  assert.equal(expected.filter((id) => id.endsWith('/cms-webkit')).length, 81)
  const shards = [1, 2, 3, 4].flatMap((index) => list([`--shard=${index}/4`]))
  assert.equal(new Set(shards).size, shards.length)
  assert.deepEqual(shards.sort(), expected)
})
