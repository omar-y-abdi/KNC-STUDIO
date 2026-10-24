import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { recordArtifact, verifyArtifact, sourceIdentity } from './build-artifact.mjs'

// ESLint already supplies this parser; keep workflow checks on the installed dependency tree.
const { load } = createRequire(import.meta.url)('js-yaml')
const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'))
const action = (name) => load(readFileSync(`.github/actions/${name}/action.yml`, 'utf8'))

test('workflow keeps plain Bash, formatted source, strict browser reports and protected gates', () => {
  assert.equal(workflow.defaults.run.shell, 'bash')
  for (const job of Object.values(workflow.jobs))
    for (const step of job.steps) {
      assert.notEqual(step['continue-on-error'], true)
      if (step.shell) assert.equal(step.shell, 'bash')
      if (step.run) assert.doesNotMatch(step.run, /furl_ci\.py/)
    }
  const node = action('ci-node')
  assert.ok(node.runs.steps.some((step) => step.run === 'npm ci'))
  assert.ok(!node.runs.steps.some((step) => step.run?.includes('setup-furl')))
  const quality = workflow.jobs.quality.steps
  const regressionDependencies = quality.findIndex(
    (step) => step.run === 'bash tools/ci/setup-furl.sh',
  )
  const regressionTests = quality.findIndex(
    (step) => step.name === 'Verify CI orchestration and failure paths',
  )
  assert.ok(regressionDependencies >= 0 && regressionTests > regressionDependencies)
  for (const id of ['frontend', 'database']) {
    const job = workflow.jobs[id]
    assert.equal(job.if, 'always()')
    const gate = job.steps.find((step) => step.run?.startsWith('node tools/ci/check-gate.mjs '))
    assert.ok(gate)
    assert.deepEqual(gate.run.split(' ').slice(2).sort(), job.needs.toSorted())
    for (const dependency of job.needs) assert.ok(workflow.jobs[dependency])
  }
  for (const id of ['public-browsers', 'cms', 'startup', 'database-current']) {
    const job = workflow.jobs[id]
    const report = job.steps.find(
      (step) => step.name === 'Reject missing, skipped or retried outcomes and source drift',
    )
    assert.ok(report, id)
    assert.equal(report.if, undefined)
    const expected = job.container ? '.ci-expected.json' : '"$RUNNER_TEMP/expected.json"'
    assert.ok(
      report.run.includes(
        `node tools/ci/verify-playwright-report.mjs ${expected} test-results/results.json`,
      ),
      id,
    )
    assert.ok(report.run.includes('verify-source .ci-source'), id)
    assert.ok(
      job.steps.some((step) => step.run?.includes('--list --reporter=json')),
      id,
    )
    assert.ok(
      job.steps.some((step) => step.uses === './.github/actions/ci-node'),
      id,
    )
  }
  assert.match(
    readFileSync('playwright.config.ts', 'utf8'),
    /forbidOnly: Boolean\(process.env\['CI'\]\)/,
  )
})

test('only browser-only jobs use the matching Playwright image and skip browser installation', () => {
  const { devDependencies } = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(devDependencies.playwright, devDependencies['@playwright/test'])
  for (const id of ['public-browsers', 'cms', 'startup']) {
    const job = workflow.jobs[id]
    assert.equal(
      job.container.image,
      `mcr.microsoft.com/playwright:v${devDependencies['@playwright/test']}-noble`,
    )
    assert.equal(job.container.options, '--user 1001 --ipc=host')
    assert.equal(job.env.NPM_CONFIG_CACHE, undefined)
    assert.ok(!job.steps.some((step) => step.uses === './.github/actions/ci-browsers'), id)
    assert.ok(!job.steps.some((step) => /playwright install/.test(step.run ?? '')), id)
  }
  for (const id of ['database-current', 'database-rollout'])
    assert.equal(workflow.jobs[id].container, undefined, id)
  const browsers = workflow.jobs['database-current'].steps.find(
    (step) => step.uses === './.github/actions/ci-browsers',
  )
  assert.deepEqual(browsers.with, {
    engines: 'chromium firefox webkit',
    cache: '${{ env.CI_CACHE }}',
  })
  const install = action('ci-browsers').runs.steps
  assert.ok(install.some((step) => step.uses?.startsWith('actions/cache@')))
  assert.ok(install.some((step) => step.run?.includes('playwright install --with-deps')))
  assert.deepEqual(workflow.jobs['public-browsers'].strategy.matrix.shard, [1, 2])
  assert.deepEqual(workflow.jobs.startup.strategy.matrix.engine, ['chromium', 'webkit'])
})

test('container preparation checks uid and write access before caches, artifacts and npm ci', () => {
  const steps = action('ci-node').runs.steps
  const permissions = steps[0]
  assert.equal(permissions.name, 'Verify container write access')
  assert.equal(permissions.if, "${{ job.container.id != '' }}")
  assert.equal(permissions.shell, 'bash')
  assert.ok(permissions.run.includes('test "$(id -u)" = 1001'))
  assert.ok(permissions.run.includes('export NPM_CONFIG_CACHE="$RUNNER_TEMP/npm-cache"'))
  assert.ok(permissions.run.includes('echo "NPM_CONFIG_CACHE=$NPM_CONFIG_CACHE" >> "$GITHUB_ENV"'))
  assert.ok(permissions.run.includes('test -w "$directory"'))
  const directories = permissions.run.match(/^for directory in (.+); do$/m)?.[1]
  assert.ok(directories)
  for (const path of [
    '"$HOME"',
    '"$GITHUB_WORKSPACE"',
    '"$RUNNER_TEMP"',
    '"$NPM_CONFIG_CACHE"',
    '.ci-source',
    '.ci-build',
    'node_modules',
    'test-results',
    'playwright-report',
    '"${TMPDIR:-/tmp}"',
  ])
    assert.ok(directories.includes(path), path)
  assert.ok(steps.findIndex((step) => step.uses?.startsWith('actions/setup-node@')) > 0)
  assert.ok(steps.findIndex((step) => step.uses?.startsWith('actions/download-artifact@')) > 0)
  assert.ok(steps.findIndex((step) => step.run === 'npm ci') > 0)
})

test('container paths come from shell variables or the working directory', () => {
  const hostPath = /\b(?:github\.workspace|runner\.(?:temp|tool_cache))\b/
  const node = action('ci-node')
  assert.doesNotMatch(JSON.stringify(node), hostPath)
  const source = node.runs.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'))
  assert.equal(source.with.path, '.ci-source')
  for (const id of ['public-browsers', 'cms', 'startup']) {
    const job = workflow.jobs[id]
    assert.doesNotMatch(JSON.stringify(job), hostPath, id)
    for (const step of job.steps)
      if (step.with?.path) assert.doesNotMatch(step.with.path, /\$\{\{/, id)
    const discover = job.steps.find((step) => step.run?.includes('--list --reporter=json'))
    assert.ok(discover.run.includes('> .ci-expected.json'), id)
    const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
    assert.ok(upload.with.path.split('\n').includes('.ci-expected.json'), id)
    if (id !== 'cms') {
      const build = job.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'))
      assert.equal(build.with.path, '.ci-build')
      assert.ok(discover.run.includes('verify .ci-build'), id)
    }
  }
  assert.equal(workflow.jobs.cms.env.AXE_PATH, 'node_modules/axe-core/axe.min.js')
  assert.equal(workflow.jobs['public-browsers'].env.E2E_PUBLIC_DIST, '.ci-build/public')
  assert.equal(workflow.jobs.startup.env.E2E_STARTUP_DIST, '.ci-build/startup')
})

test('protected gate executable rejects absent, skipped, failed and cancelled dependencies', () => {
  const script = resolve('tools/ci/check-gate.mjs')
  const run = (needs) =>
    spawnSync(process.execPath, [script, 'format', 'cms'], {
      env: { ...process.env, NEEDS_JSON: JSON.stringify(needs) },
      encoding: 'utf8',
    })
  assert.equal(run({ format: { result: 'success' }, cms: { result: 'success' } }).status, 0)
  for (const result of ['failure', 'skipped', 'cancelled', 'neutral', undefined])
    assert.notEqual(run({ format: { result: 'success' }, cms: { result } }).status, 0)
  assert.notEqual(run({ format: { result: 'success' } }).status, 0)
  assert.notEqual(
    run({
      format: { result: 'success' },
      cms: { result: 'success' },
      surprise: { result: 'success' },
    }).status,
    0,
  )
})

test('shared build verification rejects corrupt, missing, extra and stale-source artifacts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knc-build-artifact-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'assets'))
  const path = join(root, 'assets', 'app.js')
  const content = 'console.log("fixture")'
  await writeFile(path, content)
  await recordArtifact(root)
  await verifyArtifact(root)
  await writeFile(path, 'corrupt')
  await assert.rejects(verifyArtifact(root), /corrupted/)
  await rm(path)
  await assert.rejects(verifyArtifact(root), /Empty|Missing/)
  await writeFile(path, content)
  await writeFile(join(root, 'extra.js'), 'extra')
  await assert.rejects(verifyArtifact(root), /extra/)
  await rm(join(root, 'extra.js'))
  const manifest = JSON.parse(await readFile(join(root, 'artifact.json'), 'utf8'))
  assert.deepEqual(manifest.source, sourceIdentity())
  manifest.source.commit = '0'.repeat(40)
  await writeFile(join(root, 'artifact.json'), JSON.stringify(manifest))
  await assert.rejects(verifyArtifact(root), /different source/)
})
