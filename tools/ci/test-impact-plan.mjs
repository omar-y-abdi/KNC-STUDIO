import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { checkGate } from './check-gate.mjs'
import { planOutputs, readPlan, selectedCommand, trustedContext } from './impact-plan.mjs'
import { createPlan } from '../modules/impact.mjs'
import { modulePaths } from '../modules/boundaries.mjs'
import { git, moduleIds } from '../modules/model.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'knc-ci-impact-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  write('.gitignore', '/.ci-source/\n')
  write('package.json', {
    private: true,
    dependencies: Object.fromEntries(moduleIds.map((id) => [`@bladeblend/${id}`, '*'])),
  })
  const inventory = {}
  for (const [id, path] of Object.entries(modulePaths)) {
    const source = id === 'backend' ? 'worker/index.ts' : 'src/index.ts'
    write(`${path}/package.json`, {
      name: `@bladeblend/${id}`,
      exports: { './entry': `./${source}` },
      dependencies: {},
    })
    write(`${path}/${source}`, 'export const value = 1\n')
    const test = `tests/unit/${id}.test.ts`
    write(test, `import '../../${path}/${source}'`)
    inventory[test] = { kind: 'unit', owners: [id], reason: 'Fixture source test' }
  }
  for (const kind of ['cms', 'public', 'startup', 'customer', 'integration']) {
    const path =
      kind === 'integration' ? 'tests/integration/backend.test.ts' : `tools/e2e/${kind}.spec.mjs`
    write(path, '')
    inventory[path] = { kind, owners: moduleIds, reason: 'Fixture runtime test' }
  }
  write('tools/modules/test-ownership.json', inventory)
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'CI fixture'],
    ['config', 'user.email', 'ci@example.invalid'],
    ['add', '.'],
    ['commit', '-qm', 'baseline'],
  ])
    git(root, args)
  const head = git(root, ['rev-parse', 'HEAD'])
  write('modules/studio/src/index.ts', 'export const value = 2\n')
  const env = {
    ...process.env,
    CI_BASE_SHA: head,
    CI_HEAD_SHA: head,
    CI_EVENT_NAME: 'pull_request',
  }
  const context = trustedContext(env, root)
  const plan = createPlan(context)
  assert.equal(plan.mode, 'affected')
  write('.ci-source/impact.json', plan)
  return { root, write, env, context, plan }
}

test('workflow context fails closed and only full events may default their base', () => {
  const head = 'a'.repeat(40)
  assert.equal(trustedContext({ CI_HEAD_SHA: head, CI_EVENT_NAME: 'push' }).base, head)
  for (const env of [
    { CI_HEAD_SHA: head, CI_EVENT_NAME: 'pull_request' },
    { CI_HEAD_SHA: 'main', CI_EVENT_NAME: 'push' },
    { CI_HEAD_SHA: head, CI_EVENT_NAME: 'unknown' },
  ])
    assert.throws(() => trustedContext(env))
})

test('aggregate CLI allows only rederived omissions and rejects altered context, plan and source', (t) => {
  const f = fixture(t)
  const expected = [
    'format',
    'quality',
    'cms',
    'edge-functions',
    'database-current',
    'database-rollout',
  ]
  const needs = Object.fromEntries(
    expected.map((id) => [id, { result: f.plan.jobs[id].required ? 'success' : 'skipped' }]),
  )
  assert.equal(needs['database-current'].result, 'skipped')
  const run = (value = needs, env = f.env) =>
    spawnSync(process.execPath, [resolve('tools/ci/check-gate.mjs'), '--plan', ...expected], {
      cwd: f.root,
      env: { ...env, NEEDS_JSON: JSON.stringify(value) },
      encoding: 'utf8',
    })
  assert.equal(run().status, 0)
  for (const result of ['failure', 'cancelled', 'neutral', undefined]) {
    assert.notEqual(run({ ...needs, 'database-current': { result } }).status, 0)
  }
  assert.notEqual(run({ ...needs, cms: { result: 'skipped' } }).status, 0)
  const missing = { ...needs }
  delete missing.cms
  assert.notEqual(run(missing).status, 0)
  assert.notEqual(run({ ...needs, surprise: { result: 'success' } }).status, 0)
  assert.notEqual(run(needs, { ...f.env, CI_EVENT_NAME: 'push' }).status, 0)
  assert.notEqual(run(needs, { ...f.env, CI_HEAD_SHA: 'b'.repeat(40) }).status, 0)
  const tampered = globalThis.structuredClone(f.plan)
  tampered.jobs.cms.required = false
  f.write('.ci-source/impact.json', tampered)
  assert.notEqual(run().status, 0)
  f.write('.ci-source/impact.json', f.plan)
  f.write('modules/studio/src/index.ts', 'export const value = 3\n')
  assert.notEqual(run().status, 0)
  rmSync(join(f.root, '.ci-source/impact.json'))
  assert.notEqual(run().status, 0)
})

test('selected command preserves literal specs, discovery filters and fatal empty selection', (t) => {
  const f = fixture(t)
  const plan = readPlan(join(f.root, '.ci-source/impact.json'), f.context)
  const execute = selectedCommand(plan, 'browser', ['cms', '--project=cms-chromium', '--shard=1/9'])
  const discover = selectedCommand(plan, 'browser', [
    'cms',
    '--project=cms-chromium',
    '--shard=1/9',
    '--list',
    '--reporter=json',
  ])
  assert.deepEqual(discover.slice(0, -2), execute)
  assert.deepEqual(selectedCommand(plan, 'units'), [
    'node_modules/vitest/vitest.mjs',
    'run',
    ...plan.tests.unit,
  ])
  assert.throws(() => selectedCommand(plan, 'browser', ['customer']), /Empty/)
  assert.throws(() => selectedCommand(plan, 'browser', ['cms', '--pass-with-no-tests']))
  const outputs = planOutputs(plan)
  assert.equal(outputs['database-current'], 'false')
  assert.equal(JSON.parse(outputs.cms_matrix).shard.length, plan.shards.cms)
  const needs = { format: { result: 'skipped' } }
  assert.throws(() => checkGate(['format'], needs, { jobs: { format: { required: false } } }))
})
