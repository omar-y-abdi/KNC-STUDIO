import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'

function list(root, args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

export function discoverBrowserFiles(root, group) {
  root = realpathSync(root)
  const report = list(
    root,
    ['node_modules/playwright/cli.js', 'test', '--list', '--reporter=json'],
    { E2E_GROUP: group },
  )
  assert.deepEqual(report.errors ?? [], [], `${group}: native discovery errors`)
  const files = new Set()
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      if (spec.tests?.length) files.add(relative(root, resolve(report.config.rootDir, spec.file)))
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites) visit(suite)
  return [...files].sort()
}

export function discoverUnitFiles(root) {
  root = realpathSync(root)
  return list(root, ['node_modules/vitest/vitest.mjs', 'list', '--filesOnly', '--json'])
    .map(({ file }) => relative(root, file))
    .sort()
}

// The native runner that must execute a test file, decided by its path alone.
export const runnerOf = (path) =>
  path.startsWith('tests/unit/')
    ? 'unit'
    : path.endsWith('/cms-startup.spec.mjs')
      ? 'startup'
      : path.endsWith('/customer.spec.mjs')
        ? 'customer'
        : path.includes('/cms-')
          ? 'cms'
          : 'public'

// Every unit and browser test file present in the checkout, tracked or not.
export function testFiles(root) {
  const paths = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      'tests/unit',
      'tools/e2e',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  ).split('\0')
  return [...new Set(paths)]
    .filter(
      (path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) && existsSync(resolve(root, path)),
    )
    .sort()
}

export function verifyRunnerFiles(files, runner, discovered) {
  const expected = files.filter((path) => runnerOf(path) === runner)
  assert.ok(expected.length > 0, `${runner} test files must exist`)
  assert.deepEqual(
    discovered,
    expected,
    `${runner} native discovery differs from the files on disk`,
  )
}
