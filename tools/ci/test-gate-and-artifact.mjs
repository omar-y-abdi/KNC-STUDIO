import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { recordArtifact, verifyArtifact, sourceIdentity } from './build-artifact.mjs'

const { load } = createRequire(import.meta.url)('js-yaml')
const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'))
const action = (name) => load(readFileSync(`.github/actions/${name}/action.yml`, 'utf8'))

function assertNativeShells(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (key === 'shell') assert.doesNotMatch(child, /furl/i)
    if (key === 'run' && typeof child === 'string')
      assert.doesNotMatch(child, /\btools\/ci\/furl_ci\.py\b/)
    assertNativeShells(child)
  }
}

test('workflow keeps plain Bash, formatted source, strict browser reports and protected gates', () => {
  assert.equal(workflow.defaults.run.shell, 'bash')
  assertNativeShells(workflow)
  for (const job of Object.values(workflow.jobs))
    for (const step of job.steps) {
      assert.notEqual(step['continue-on-error'], true)
      if (step.shell) assert.equal(step.shell, 'bash')
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
  assert.ok(
    quality[regressionTests].run.includes(
      "python3 -m unittest discover -s tools/ci -p 'test_furl_ci.py' -v",
    ),
  )
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

test('native shell guard allows Furl regressions but rejects default, job and step wrappers', () => {
  const regression = { run: "python3 -m unittest discover -s tools/ci -p 'test_furl_ci.py' -v" }
  assert.doesNotThrow(() => assertNativeShells({ steps: [regression] }))
  for (const mutation of [
    { defaults: { run: { shell: 'python3 tools/ci/furl_ci.py {0}' } } },
    { jobs: { quality: { defaults: { run: { shell: 'python3 tools/ci/furl_ci.py {0}' } } } } },
    { steps: [{ shell: 'python3 tools/ci/furl_ci.py {0}', run: 'npm ci' }] },
    { steps: [{ shell: 'bash', run: 'python3 tools/ci/furl_ci.py npm ci' }] },
  ])
    assert.throws(() => assertNativeShells(mutation), /furl/i)
})

test('uploads explicitly preserve every hidden CI plan', () => {
  const uploads = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.filter(
      (step) =>
        step.uses?.startsWith('actions/upload-artifact@') &&
        /(?:^|\/)\.ci-/m.test(step.with?.path ?? ''),
    ),
  )
  assert.ok(uploads.length > 0)
  for (const upload of uploads) assert.equal(upload.with['include-hidden-files'], true)
})

test('Dependabot groups both Playwright packages and documents the coupled image update', () => {
  const source = readFileSync('.github/dependabot.yml', 'utf8')
  const npm = load(source).updates.find(
    (update) => update['package-ecosystem'] === 'npm' && update.directory === '/',
  )
  assert.deepEqual(npm.groups.playwright.patterns.toSorted(), ['@playwright/test', 'playwright'])
  assert.match(
    source,
    /# Bump mcr\.microsoft\.com\/playwright:v<version>-noble in ci\.yml in the same PR\./,
  )
})

test('the YAML parser is a direct exact dependency matching the existing installed lock entry', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  const version = manifest.devDependencies['js-yaml']
  assert.match(version, /^\d+\.\d+\.\d+$/)
  assert.equal(version, lock.packages[''].devDependencies['js-yaml'])
  assert.equal(version, lock.packages['node_modules/js-yaml'].version)
})

test('CI documentation describes event coverage and the actual preparation owners', () => {
  const docs = readFileSync('docs/CI.md', 'utf8').replace(/\s+/g, ' ')
  assert.doesNotMatch(docs, /runs the complete graph|source identity verification and Furl setup/)
  assert.ok(docs.includes('Pull requests run the full Chromium CMS matrix'))
  assert.ok(docs.includes('Pushes to `main` and manual runs use the full WebKit CMS matrix'))
  assert.ok(docs.includes('Furl setup and regression tests belong to the quality job'))
  assert.ok(docs.includes(workflow.jobs.cms.container.image))
  assert.ok(docs.includes('UID 1001'))
  assert.ok(docs.includes('`nodeModulesDir: none`'))
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

test('Edge entrypoint loop rejects zero entrypoints and propagates every Deno failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knc-edge-loop-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const step = workflow.jobs['edge-functions'].steps.find(
    (step) => step.name === 'Type-check every Edge Function entrypoint',
  )
  assert.equal(step['working-directory'], 'supabase/functions')
  await writeFile(join(root, 'check.sh'), step.run)
  const bin = join(root, 'bin')
  await mkdir(bin)
  const log = join(root, 'calls.jsonl')
  await writeFile(
    join(bin, 'deno'),
    '#!/usr/bin/env node\n' +
      "require('node:fs').appendFileSync(process.env.DENO_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n')\n" +
      'process.exit(Number(process.env.DENO_STATUS))\n',
    { mode: 0o755 },
  )
  const run = (status = 0) =>
    spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'check.sh'], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DENO_CALLS: log,
        DENO_STATUS: String(status),
      },
      encoding: 'utf8',
      timeout: 10000,
    })
  const empty = run()
  assert.notEqual(empty.status, null, empty.error?.message)
  assert.notEqual(empty.status, 0, 'An empty Edge graph must fail')
  for (const name of ['a-function', 'b-function']) {
    await mkdir(join(root, name))
    await writeFile(join(root, name, 'index.ts'), 'export {}\n')
  }
  const success = run()
  assert.equal(success.status, 0, success.stderr)
  const calls = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(calls, [
    ['check', '--config', 'deno.json', '--frozen', './a-function/index.ts'],
    ['check', '--config', 'deno.json', '--frozen', './b-function/index.ts'],
  ])
  await writeFile(log, '')
  const failure = run(7)
  assert.equal(failure.status, 7, failure.stderr)
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1)
})

async function sourceFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'knc-source-tree-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n'
  await writeFile(join(root, 'tracked.txt'), lines)
  await writeFile(join(root, 'tracked.bin'), Buffer.from([0, 255, 128, 10]))
  git('init', '--quiet')
  git('config', 'user.name', 'CI test')
  git('config', 'user.email', 'ci-test@example.invalid')
  git('add', '.')
  git('-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '--quiet', '-m', 'fixture')
  return { root, git, lines }
}

test('source identity hashes tracked text, binary content and deletions independent of diff formatting', async (t) => {
  const { root, git, lines } = await sourceFixture(t)
  const initial = sourceIdentity(root)
  assert.equal(initial.commit, git('rev-parse', 'HEAD'))
  assert.equal(initial.tree, git('rev-parse', 'HEAD^{tree}'))
  await writeFile(join(root, 'tracked.txt'), lines.replace('line 20\n', 'edited line\n'))
  git('config', 'diff.context', '1')
  const narrowDiff = git('diff', 'HEAD', '--binary')
  const edited = sourceIdentity(root)
  assert.notEqual(edited.tree, initial.tree)
  git('config', 'diff.context', '8')
  assert.notEqual(git('diff', 'HEAD', '--binary'), narrowDiff)
  assert.deepEqual(sourceIdentity(root), edited)
  await writeFile(join(root, 'tracked.bin'), Buffer.from([0, 254, 128, 10]))
  const binary = sourceIdentity(root)
  assert.notEqual(binary.tree, edited.tree)
  await rm(join(root, 'tracked.txt'))
  assert.notEqual(sourceIdentity(root).tree, binary.tree)
})

test('source identity ignores downloaded and other untracked files and preserves the real index', async (t) => {
  const { root, git } = await sourceFixture(t)
  const index = await readFile(join(root, '.git', 'index'))
  const initial = sourceIdentity(root)
  assert.equal(initial.tree, git('rev-parse', 'HEAD^{tree}'))
  for (const name of ['.ci-source', '.ci-build']) {
    await mkdir(join(root, name))
    await writeFile(join(root, name, 'download.json'), '{"downloaded":true}\n')
  }
  await writeFile(join(root, '.ci-expected.json'), '{}\n')
  await writeFile(join(root, 'untracked.txt'), 'untracked\n')
  assert.deepEqual(sourceIdentity(root), initial)
  assert.deepEqual(await readFile(join(root, '.git', 'index')), index)
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
