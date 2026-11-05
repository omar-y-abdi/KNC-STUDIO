import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectBoundaries, modulePaths, repositoryRoot, walkFiles } from './boundaries.mjs'
import { loadInventory, selectVerification, unitOwnership } from './model.mjs'

export function modulePlan(id, root = repositoryRoot) {
  assert.ok(Object.hasOwn(modulePaths, id), `Unknown module ${id}`)
  const graph = inspectBoundaries(root)
  assert.deepEqual(
    [...graph.errors, ...graph.unsupported],
    [],
    'Module boundaries must pass before local selection',
  )
  const { inventory, errors } = loadInventory(root)
  assert.deepEqual(errors, [], 'Every test must have explicit ownership')
  const units = unitOwnership(root, inventory, graph)
  const path =
    id === 'backend'
      ? 'supabase/worker/__whole_module__.ts'
      : `${modulePaths[id]}/src/__whole_module__.ts`
  return selectVerification([{ path, status: 'M' }], graph, inventory, units)
}

export function commandsFor(id, task, plan, root = repositoryRoot) {
  const boundary = { executable: process.execPath, args: ['tools/modules/boundaries.mjs'] }
  const typecheck = { executable: 'npm', args: ['run', 'typecheck'] }
  const lint = {
    executable: process.execPath,
    args: [
      'node_modules/eslint/bin/eslint.js',
      id === 'backend' ? 'supabase/worker' : modulePaths[id],
    ],
  }
  const unit = {
    executable: process.execPath,
    args: ['node_modules/vitest/vitest.mjs', 'run', ...plan.tests.unit],
  }
  assert.ok(plan.tests.unit.length, 'No module tests selected')
  const edgeChecks =
    id === 'backend'
      ? walkFiles(root, 'supabase/functions')
          .filter((path) => /^supabase\/functions\/[^/]+\/index\.ts$/.test(path))
          .map((path) => ({
            executable: 'deno',
            cwd: 'supabase/functions',
            args: [
              'check',
              '--config',
              'deno.json',
              '--frozen',
              `./${path.slice('supabase/functions/'.length)}`,
            ],
          }))
      : []
  if (id === 'backend') assert.ok(edgeChecks.length, 'No Edge Function entrypoints found')
  const commands = {
    check: [boundary, typecheck, ...edgeChecks, lint, unit],
    test: [unit],
    lint: [lint],
    typecheck: [typecheck, ...edgeChecks],
    build: [
      ...edgeChecks,
      { executable: 'npm', args: ['run', 'build'] },
      ...(id === 'backend'
        ? [
            {
              executable: process.execPath,
              args: ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run'],
            },
          ]
        : []),
    ],
    ...(id === 'backend'
      ? {
          database: [
            {
              executable: process.execPath,
              args: ['node_modules/supabase/dist/supabase.js', 'test', 'db'],
            },
          ],
        }
      : {}),
  }
  assert.ok(commands[task], `Unknown module task ${task}`)
  return commands[task]
}

// Native Playwright owns discovery, execution and server setup. Both invocations receive the
// identical literal spec filters; the existing report verifier rejects skips and missing cases.
export function browserArguments(paths, extra = []) {
  assert.ok(Array.isArray(paths) && paths.length > 0, 'Empty browser selection')
  assert.ok(
    paths.every((path) => /^tools\/e2e\/[a-z0-9.-]+\.spec\.mjs$/.test(path)),
    'Invalid browser spec path',
  )
  const filters = paths.map((path) => `${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  return ['node_modules/playwright/cli.js', 'test', ...filters, ...extra]
}

function execute(command, root, options = {}) {
  const result = spawnSync(command.executable, command.args, {
    cwd: command.cwd ? resolve(root, command.cwd) : root,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Failed: ${command.executable} ${command.args.join(' ')}`)
  return result
}

export function runBrowser(paths, group, root = repositoryRoot) {
  assert.ok(['cms', 'public', 'startup', 'customer'].includes(group), 'Unknown browser group')
  const directory = mkdtempSync(join(tmpdir(), 'bladeblend-module-browser-'))
  const env = { ...process.env, E2E_GROUP: group, E2E_ARTIFACTS_ROOT: directory }
  const args = browserArguments(paths)
  try {
    const discovered = execute(
      { executable: process.execPath, args: [...args, '--list', '--reporter=json'] },
      root,
      { env, stdio: 'pipe', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
    const expected = join(directory, 'expected.json')
    writeFileSync(expected, discovered.stdout)
    execute({ executable: process.execPath, args }, root, { env })
    execute(
      {
        executable: process.execPath,
        args: [
          'tools/ci/verify-playwright-report.mjs',
          expected,
          join(directory, 'test-results/results.json'),
        ],
      },
      root,
    )
    rmSync(directory, { recursive: true, force: true })
  } catch (error) {
    console.error(`Browser evidence retained: ${directory}`)
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, task, ...options] = process.argv.slice(2)
  assert.ok(
    options.every((option) => option === '--dry-run'),
    'Only --dry-run is supported',
  )
  const plan = modulePlan(id)
  if (task === 'plan')
    console.log(
      JSON.stringify(
        {
          module: id,
          scope: 'Whole module local verification; not a CI omission authorization',
          ...plan,
        },
        null,
        2,
      ),
    )
  else if (task === 'browser') {
    const group =
      id === 'studio'
        ? 'cms'
        : id === 'staff-admin'
          ? 'public'
          : id === 'backend'
            ? 'customer'
            : 'public'
    if (options.includes('--dry-run'))
      console.log(
        JSON.stringify(
          { env: { E2E_GROUP: group }, args: browserArguments(plan.tests.browser[group]) },
          null,
          2,
        ),
      )
    else runBrowser(plan.tests.browser[group], group)
  } else {
    const commands = commandsFor(id, task, plan)
    if (options.includes('--dry-run')) console.log(JSON.stringify(commands, null, 2))
    else for (const command of commands) execute(command, repositoryRoot)
  }
}
