import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
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

export function verifyOwnedFiles(inventory, kind, discovered) {
  const expected = Object.entries(inventory)
    .filter(([, entry]) => entry.kind === kind)
    .map(([path]) => path)
    .sort()
  assert.ok(expected.length > 0, `${kind} ownership must not be empty`)
  assert.deepEqual(discovered, expected, `${kind} native discovery differs from declared ownership`)
}
