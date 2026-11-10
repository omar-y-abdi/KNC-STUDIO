import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { checkGate } from './check-gate.mjs'
import {
  changeReasons,
  createPlan,
  git,
  jobs,
  planOutputs,
  readPlan,
  selectedCommand,
  trustedContext,
  verifyPlan,
} from './impact-plan.mjs'
import { inspectBoundaries, modulePaths, repositoryRoot } from '../modules/boundaries.mjs'

const studio = 'modules/studio/src/index.ts'
const staff = 'modules/staff-admin/src/index.ts'
const omitted = (plan) => jobs.filter((job) => !plan.jobs[job].required)
const backendJobs = ['edge-functions', 'database-current']

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'knc-ci-impact-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  write('.gitignore', '/.ci-source/\n/node_modules/\n')
  write('package.json', {
    private: true,
    dependencies: Object.fromEntries(
      Object.keys(modulePaths).map((id) => [`@bladeblend/${id}`, '*']),
    ),
  })
  for (const [id, path] of Object.entries(modulePaths)) {
    const source = id === 'backend' ? 'worker/index.ts' : 'src/index.ts'
    write(`${path}/package.json`, {
      name: `@bladeblend/${id}`,
      exports: { './entry': `./${source}` },
      dependencies: {},
    })
    write(`${path}/${source}`, 'export const value = 1\n')
  }
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'CI fixture'],
    ['config', 'user.email', 'ci@example.invalid'],
  ])
    git(root, args)
  // Each commit stands for the pull request's base; later edits stay in the working tree.
  const commit = () => {
    git(root, ['add', '.'])
    git(root, ['commit', '-qm', 'base', '--allow-empty'])
    const head = git(root, ['rev-parse', 'HEAD'])
    const env = {
      ...process.env,
      CI_BASE_SHA: head,
      CI_HEAD_SHA: head,
      CI_EVENT_NAME: 'pull_request',
    }
    return { env, context: trustedContext(env, root) }
  }
  return { root, write, commit, ...commit() }
}

function studioFixture(t) {
  const f = fixture(t)
  f.write(studio, 'export const value = 2\n')
  const plan = createPlan(f.context)
  assert.equal(plan.mode, 'affected')
  f.write('.ci-source/impact.json', plan)
  return { ...f, plan }
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

test('in-place Studio and staff-admin source edits omit exactly the two backend jobs', (t) => {
  const f = fixture(t)
  for (const paths of [[studio], [staff], [staff, studio]]) {
    for (const path of paths) f.write(path, 'export const value = 2\n')
    const plan = createPlan(f.context)
    assert.equal(plan.mode, 'affected', paths.join())
    assert.deepEqual(plan.reasons, [])
    assert.deepEqual(
      plan.changes,
      paths.map((path) => ({ status: 'M', path })),
    )
    assert.deepEqual(omitted(plan), backendJobs)
    assert.deepEqual(createPlan(f.context), plan)
    git(f.root, ['checkout', '--', '.'])
  }
  // No single Studio file has a narrower plan than the workspace.
  assert.deepEqual(
    changeReasons([{ status: 'M', path: 'modules/studio/src/DeliveryStatus.tsx' }]),
    [],
  )
  assert.deepEqual(
    changeReasons([{ status: 'M', path: 'modules/staff-admin/src/adapters/bookingsAdmin.ts' }]),
    [],
  )
})

test('every other workspace, file type, location and status requires every job', () => {
  const modified = [
    'modules/public-web/src/App.tsx',
    'packages/content-contracts/src/cms.ts',
    'packages/backend-contracts/src/rpcSchemas.ts',
    'supabase/worker/index.ts',
    'supabase/functions/cms-studio/index.ts',
    'supabase/migrations/001.sql',
    'supabase/tests/01_test.sql',
    'supabase/config.toml',
    'public/tokens.css',
    'public/logo.svg',
    'modules/studio/src/studio.css',
    'modules/studio/src/contact.en.html',
    'modules/studio/src/config.json',
    'modules/studio/src/legacy.txt',
    'modules/studio/package.json',
    'modules/studio/tsconfig.json',
    'modules/studio/index.ts',
    'tools/e2e/modules/studio/src/index.ts',
    'modules/staff-admin/src/AdminShell.css',
    'src/main.tsx',
    'vite.config.ts',
    'package.json',
    'package-lock.json',
    'tools/e2e/admin-harness.tsx',
    'tools/e2e/cms-owner.spec.mjs',
    'tools/modules/boundaries.mjs',
    'tests/unit/studio.test.ts',
    'tests/integration/booking.test.ts',
    '.github/workflows/ci.yml',
    'docs/CI.md',
    'README.md',
    'unknown.txt',
  ].map((path) => ({ status: 'M', path }))
  const edit = { status: 'M', path: studio }
  for (const change of [
    ...modified,
    { status: 'A', path: 'modules/studio/src/new.ts' },
    { status: 'D', path: studio },
    { status: 'R100', path: 'modules/studio/src/rename.ts' },
    { status: 'T', path: studio },
    { status: 'A', path: 'supabase/migrations/20990101000000_new.sql' },
  ]) {
    assert.equal(changeReasons([change]).length, 1, change.path)
    // One such change is enough, whatever else the pull request edits.
    assert.equal(changeReasons([edit, change]).length, 1, change.path)
  }
  assert.equal(changeReasons([]).length, 1)
})

test('bad comparison context, other events, untracked files and an empty diff fail closed', (t) => {
  const f = fixture(t)
  const full = (plan, reason) => {
    assert.equal(plan.mode, 'full', String(reason))
    assert.deepEqual(omitted(plan), [], String(reason))
    assert.ok(
      plan.reasons.some((entry) => reason.test(entry)),
      `${reason}: ${plan.reasons}`,
    )
  }
  full(createPlan(f.context), /Empty change set/)
  f.write(studio, 'export const value = 2\n')
  assert.equal(createPlan(f.context).mode, 'affected')
  full(createPlan({ ...f.context, base: 'missing' }), /invalid exact base/)
  full(createPlan({ ...f.context, base: 'f'.repeat(40) }), /invalid exact base/)
  full(createPlan({ ...f.context, base: undefined }), /invalid exact base/)
  full(createPlan({ ...f.context, head: 'b'.repeat(40) }), /stale exact head/)
  full(createPlan({ ...f.context, event: 'push' }), /Full verification event: push/)
  full(createPlan({ ...f.context, event: 'workflow_dispatch' }), /workflow_dispatch/)
  const sibling = git(f.root, ['commit-tree', 'HEAD^{tree}', '-m', 'unrelated'])
  full(createPlan({ ...f.context, base: sibling }), /not an ancestor/)
  f.write('modules/studio/src/untracked.ts', 'export {}\n')
  full(createPlan(f.context), /Untracked inputs: modules\/studio\/src\/untracked.ts/)
})

test('added, deleted and renamed source files in the real diff require every job', (t) => {
  const f = fixture(t)
  f.write('modules/studio/src/panel.ts', 'export const panel = 1\n')
  const base = f.commit().context.base
  const plan = () => createPlan({ ...f.commit().context, base })
  f.write('modules/studio/src/added.ts', 'export const added = 1\n')
  assert.deepEqual(plan().changes, [{ status: 'A', path: 'modules/studio/src/added.ts' }])
  assert.deepEqual(omitted(plan()), [])
  git(f.root, ['mv', 'modules/studio/src/panel.ts', 'modules/studio/src/renamed.ts'])
  assert.deepEqual(
    plan().changes.map(({ status }) => status),
    ['A', 'D', 'A'],
  )
  assert.deepEqual(omitted(plan()), [])
})

test('plans bind formatted tracked content, trusted base/head/event and every omission', (t) => {
  const f = studioFixture(t)
  assert.deepEqual(f.plan.changes, [{ path: studio, status: 'M' }])
  verifyPlan(f.plan, f.context)
  const corrupted = globalThis.structuredClone(f.plan)
  corrupted.jobs.cms.required = false
  assert.throws(() => verifyPlan(corrupted, f.context), /differs/)
  assert.throws(() => verifyPlan(f.plan, { ...f.context, event: 'push' }), /differs/)
  assert.throws(() => verifyPlan(f.plan, { ...f.context, base: 'f'.repeat(40) }), /differs/)
  assert.throws(() => verifyPlan(f.plan), /Trusted/)
  f.write(studio, 'export const value = 3\n')
  assert.throws(() => verifyPlan(f.plan, f.context), /differs/)
  assert.notEqual(f.plan.source.tree, createPlan(f.context).source.tree)
  // A plan made before a change that needs every job cannot keep its omissions.
  f.write('modules/studio/src/studio.css', '.studio {}\n')
  assert.throws(() => verifyPlan(f.plan, f.context), /differs/)
})

test('broken boundaries and unreadable browser or integration harness imports require every job', (t) => {
  for (const [path, text, reason] of [
    [
      'tools/e2e/public.spec.mjs',
      'page.evaluate(async (path) => import(path), "/x")',
      /Unreadable/,
    ],
    ['tests/integration/backend.test.ts', "import './missing'", /Unreadable harness dependency/],
    [
      'modules/public-web/src/index.ts',
      "import '@bladeblend/backend/entry'",
      /forbidden dependency/,
    ],
  ]) {
    const f = fixture(t)
    f.write(path, text)
    const { context } = f.commit()
    f.write(studio, 'export const value = 2\n')
    const plan = createPlan(context)
    assert.deepEqual(plan.changes, [{ path: studio, status: 'M' }])
    assert.equal(plan.mode, 'full', path)
    assert.deepEqual(omitted(plan), [], path)
    assert.ok(
      plan.reasons.some((entry) => reason.test(entry)),
      `${path}: ${plan.reasons}`,
    )
  }
  // The unit suite always runs whole, so what a unit test reads cannot widen a plan.
  const f = fixture(t)
  f.write('tests/unit/dynamic.test.ts', 'const name = "./x"; await import(name)')
  const { context } = f.commit()
  f.write(studio, 'export const value = 2\n')
  assert.deepEqual(omitted(createPlan(context)), backendJobs)
})

test('the repository itself has no unreadable browser or integration harness import', () => {
  const graph = inspectBoundaries(repositoryRoot)
  assert.deepEqual([...graph.errors, ...graph.unsupported], [])
  assert.deepEqual(
    graph.testUnsupported.filter(({ file }) => !file.startsWith('tests/unit/')),
    [],
    'Every pull request would silently run every job',
  )
})

test('aggregate CLI allows only rederived omissions and rejects altered context, plan and source', (t) => {
  const f = studioFixture(t)
  const expected = ['format', 'quality', 'cms', 'edge-functions', 'database-current']
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
  f.write(studio, 'export const value = 3\n')
  assert.notEqual(run().status, 0)
  rmSync(join(f.root, '.ci-source/impact.json'))
  assert.notEqual(run().status, 0)
})

test('selected commands run whole native suites and refuse filters and omitted groups', (t) => {
  const f = studioFixture(t)
  const plan = readPlan(join(f.root, '.ci-source/impact.json'), f.context)
  const execute = selectedCommand(plan, 'browser', ['cms', '--project=cms-chromium', '--shard=1/9'])
  const discover = selectedCommand(plan, 'browser', [
    'cms',
    '--project=cms-chromium',
    '--shard=1/9',
    '--list',
    '--reporter=json',
  ])
  assert.deepEqual(execute, [
    'node_modules/playwright/cli.js',
    'test',
    '--project=cms-chromium',
    '--shard=1/9',
  ])
  assert.deepEqual(discover.slice(0, -2), execute)
  assert.deepEqual(selectedCommand(plan, 'units'), ['node_modules/vitest/vitest.mjs', 'run'])
  assert.throws(() => selectedCommand(plan, 'units', ['tests/unit/studio.test.ts']))
  assert.throws(() => selectedCommand(plan, 'browser', ['customer']), /omitted/)
  assert.throws(() => selectedCommand(plan, 'browser', ['unknown']), /Unknown browser group/)
  assert.throws(() => selectedCommand(plan, 'browser', ['cms', '--pass-with-no-tests']))
  assert.throws(() => selectedCommand(plan, 'browser', ['cms', 'tools/e2e/cms-owner.spec.mjs']))
  assert.throws(() => selectedCommand(plan, 'browser', ['cms', '--grep=owner']))
  const needs = { format: { result: 'skipped' } }
  assert.throws(() => checkGate(['format'], needs, { jobs: { format: { required: false } } }))
})

test('the CLI exports one decision per workflow job and binds each browser run to its group', (t) => {
  const f = studioFixture(t)
  const cli = resolve('tools/ci/impact-plan.mjs')
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: f.root,
      env: { ...f.env, ...env },
      encoding: 'utf8',
    })
  const outputs = join(f.root, '.ci-source/outputs')
  const created = run(['create', join(f.root, '.ci-source/created.json')], {
    GITHUB_OUTPUT: outputs,
  })
  assert.equal(created.status, 0, created.stderr)
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.root, '.ci-source/created.json'), 'utf8')),
    f.plan,
  )
  const exported = Object.fromEntries(
    readFileSync(outputs, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  )
  assert.deepEqual(exported, planOutputs(f.plan))
  assert.deepEqual(
    Object.entries(exported)
      .filter(([, required]) => required !== 'true')
      .sort(),
    backendJobs.map((job) => [job, 'false']).sort(),
  )
  // The workflow reads exactly these outputs, and every skippable job is conditioned on its own.
  const { load } = createRequire(import.meta.url)('js-yaml')
  const text = readFileSync('.github/workflows/ci.yml', 'utf8')
  const workflow = load(text)
  assert.deepEqual(Object.keys(workflow.jobs.format.outputs), jobs)
  for (const [id, value] of Object.entries(workflow.jobs.format.outputs))
    assert.equal(value, `\${{ steps.impact.outputs.${id} }}`)
  for (const [, id] of text.matchAll(/needs\.format\.outputs\.([\w-]+)/g))
    assert.ok(jobs.includes(id), id)
  assert.match(run(['verify']).stdout, /^Verified affected /)
  // Stand-ins for the native runners report how the wrapper invoked them.
  const stub =
    'console.log(JSON.stringify([process.env.E2E_GROUP ?? null, ...process.argv.slice(2)]))'
  f.write('node_modules/playwright/cli.js', stub)
  f.write('node_modules/vitest/vitest.mjs', stub)
  const browser = run(['browser', 'cms', '--project=cms-webkit', '--list', '--reporter=json'], {
    E2E_GROUP: 'public',
  })
  assert.deepEqual(JSON.parse(browser.stdout), [
    'cms',
    'test',
    '--project=cms-webkit',
    '--list',
    '--reporter=json',
  ])
  assert.deepEqual(JSON.parse(run(['units']).stdout).slice(1), ['run'])
  assert.notEqual(run(['browser', 'customer']).status, 0)
  assert.notEqual(run(['browser', 'cms'], { CI_EVENT_NAME: 'push' }).status, 0)
})
