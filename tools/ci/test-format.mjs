import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const script = join(root, 'tools/ci/format.sh')
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')

function fixture(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'knc-format-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const env = {
    ...process.env,
    PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH}`,
    RUNNER_TEMP: directory,
  }
  const run = (command, args) =>
    spawnSync(command, args, { cwd: directory, env, encoding: 'utf8', timeout: 30000 })
  const git = (...args) => {
    const result = run('git', args)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ scripts: { format: scripts.format, 'format:check': scripts['format:check'] } }, null, 2) + '\n',
  )
  writeFileSync(join(directory, '.prettierrc.json'), readFileSync(join(root, '.prettierrc.json')))
  writeFileSync(join(directory, '.prettierignore'), 'ignored.js\nformat.patch\n')
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content)
  git('init', '--quiet')
  git('config', 'user.name', 'CI test')
  git('config', 'user.email', 'ci-test@example.invalid')
  git('add', '.')
  git('commit', '--quiet', '-m', 'fixture')
  return { directory, run, git, read: (name) => readFileSync(join(directory, name), 'utf8') }
}

test('workflow formats first and shares the same patch with every dependent job', () => {
  assert.match(workflow, /^jobs:\n  format:/m)
  assert.match(workflow, /contents: read/)
  assert.doesNotMatch(workflow, /contents: write|pull_request_target|continue-on-error/)
  const jobs = ['format', 'frontend', 'cms-shell', 'edge-functions', 'database']
  const section = (job, index) =>
    workflow.split(`\n  ${job}:\n`)[1]?.split(`\n  ${jobs[index + 1]}:\n`)[0] ?? ''
  const first = section('format', 0)
  assert.ok(first.indexOf('npm ci') < first.indexOf('bash tools/ci/format.sh'))
  assert.ok(first.indexOf('bash tools/ci/format.sh') < first.indexOf('npm run lint'))
  assert.match(first, /node --test tools\/ci\/test-format.mjs/)
  assert.match(first, /overwrite: true/)
  for (const [index, job] of jobs.entries()) {
    if (job === 'format') continue
    const body = section(job, index)
    assert.match(body, /^    needs: format$/m)
    assert.match(body, /actions\/download-artifact@[0-9a-f]{40}/)
    assert.match(body, /git apply --allow-empty "\$RUNNER_TEMP\/ci-format\/format.patch"/)
    assert.ok(body.indexOf('git apply') < body.indexOf('npm ci'))
    // A stable per-run name also works when only failed jobs are re-run.
    assert.match(body, /name: ci-format-\$\{\{ github.run_id \}\}/)
  }
})

test('formats supported files, leaves unsupported and ignored files intact, and replays the patch', (t) => {
  const files = {
    'file with spaces.ts': 'export  const value={name:"Omar",count:1};\n',
    'style.css': '.example{color:red}\n',
    'settings.json': '{"enabled":true,"count":2}\n',
    'ignored.js': 'this is deliberately not valid JavaScript !!!\n',
    'query.sql': 'select   1;\n',
    'script.py': 'print(  "unchanged"  )\n',
    'image.bin': Buffer.from([0, 255, 128, 10]),
  }
  const f = fixture(t, files)
  const result = f.run('bash', [script])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const formatted = 'export const value = { name: \'Omar\', count: 1 }\n'
  assert.equal(f.read('file with spaces.ts'), formatted)
  for (const name of ['style.css', 'settings.json']) assert.notEqual(f.read(name), files[name])
  for (const name of ['ignored.js', 'query.sql', 'script.py']) assert.equal(f.read(name), files[name])
  assert.deepEqual(readFileSync(join(f.directory, 'image.bin')), files['image.bin'])
  const patch = f.read('format.patch')
  assert.match(patch, /file with spaces\.ts/)
  const tree = f.git('diff', '--binary', '--no-ext-diff')
  assert.equal(patch, tree)
  f.git('checkout', '--', '.')
  f.git('apply', '--allow-empty', join(f.directory, 'format.patch'))
  assert.equal(f.git('diff', '--binary', '--no-ext-diff'), tree)
  assert.equal(f.read('file with spaces.ts'), formatted)
})

test('already formatted input succeeds with an empty patch', (t) => {
  const f = fixture(t, { 'code.js': 'export const value = 1\n' })
  // Normalize fixture metadata, then prove a second run is a true no-op.
  const first = f.run('bash', [script])
  assert.equal(first.status, 0, first.stdout + first.stderr)
  f.git('add', '--update')
  f.git('commit', '--quiet', '--allow-empty', '-m', 'formatted baseline')
  const second = f.run('bash', [script])
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.equal(f.read('format.patch'), '')
  f.git('apply', '--allow-empty', join(f.directory, 'format.patch'))
  assert.equal(f.git('diff'), '')
})

test('syntax errors stay fatal with their diagnostic visible through Furl', (t) => {
  const f = fixture(t, { 'broken.ts': 'export const = ???\n' })
  const direct = f.run('bash', [script])
  assert.equal(direct.status, 2, direct.stdout + direct.stderr)
  const wrapped = f.run('python3', [join(root, 'tools/ci/furl_ci.py'), script])
  assert.equal(wrapped.status, direct.status, wrapped.stdout + wrapped.stderr)
  assert.match(wrapped.stdout, /broken\.ts/)
  assert.match(wrapped.stdout, /SyntaxError/)
  assert.match(wrapped.stdout, /export const =/)
})

test('formatting does not repair or suppress genuine ESLint errors', (t) => {
  const f = fixture(t, { 'code.js': 'debugger;\n' })
  const formatted = f.run('bash', [script])
  assert.equal(formatted.status, 0, formatted.stdout + formatted.stderr)
  assert.equal(f.read('code.js'), 'debugger\n')
  const lint = f.run(process.execPath, [
    join(root, 'node_modules/eslint/bin/eslint.js'),
    '--config',
    join(root, 'eslint.config.js'),
    'code.js',
  ])
  assert.equal(lint.status, 1, lint.stdout + lint.stderr)
  assert.match(lint.stdout, /no-debugger/)
})
