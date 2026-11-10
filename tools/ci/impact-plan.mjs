import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectBoundaries } from '../modules/boundaries.mjs'
import { sourceIdentity } from './build-artifact.mjs'

export const jobs = [
  'format',
  'quality',
  'build',
  'public-browsers',
  'cms',
  'startup',
  'edge-functions',
  'database-current',
]
// The only jobs a plan may omit, and only for in-place edits of Studio or staff-admin source: the
// boundary check forbids the backend, and every workspace the backend may import, from importing
// those two workspaces.
const backendJobs = ['edge-functions', 'database-current']
const browserOnlySource = /^modules\/(?:studio|staff-admin)\/src\/.+\.[cm]?[jt]sx?$/
const browserJobs = {
  cms: 'cms',
  public: 'public-browsers',
  startup: 'startup',
  customer: 'database-current',
}

export const git = (root, args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

function validCommit(root, value) {
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) return false
  try {
    return git(root, ['rev-parse', `${value}^{commit}`]) === value
  } catch {
    return false
  }
}

function changedPaths(root, base, tree) {
  const fields = git(root, ['diff', '--name-status', '--no-renames', '-z', base, tree]).split('\0')
  const result = []
  for (let index = 0; index + 1 < fields.length; index += 2)
    result.push({ status: fields[index], path: fields[index + 1] })
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

// Why a change set needs every job. Only in-place edits of Studio or staff-admin TypeScript and
// JavaScript source return none: an added, deleted or renamed file, a stylesheet or template, a
// test, tool, document, configuration file, migration or any other workspace is listed here.
export function changeReasons(changes) {
  if (!changes.length) return ['Empty change set does not authorize omitted verification']
  return changes
    .filter(({ status, path }) => status !== 'M' || !browserOnlySource.test(path))
    .map(
      ({ status, path }) => `${status} ${path}: not a modified Studio or staff-admin source file`,
    )
}

export const requiredJobs = (full) =>
  Object.fromEntries(jobs.map((job) => [job, { required: full || !backendJobs.includes(job) }]))

export function createPlan({ root, base, head, event }) {
  const source = sourceIdentity(root)
  const reasons = []
  const baseValid = validCommit(root, base)
  const headValid = validCommit(root, head) && head === source.commit
  if (!baseValid) reasons.push('Missing or invalid exact base commit')
  if (!headValid) reasons.push('Missing, invalid or stale exact head commit')
  if (event !== 'pull_request') reasons.push(`Full verification event: ${event}`)
  if (baseValid && headValid) {
    try {
      git(root, ['merge-base', '--is-ancestor', base, head])
    } catch {
      reasons.push('Base is not an ancestor of the checked-out head')
    }
  }
  const changes = baseValid ? changedPaths(root, base, source.tree) : []
  // The shared artifact identity intentionally covers tracked files. Untracked input can never
  // authorize omissions; record it separately so changes cannot hide behind that identity.
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort()
  if (untracked.length) reasons.push(`Untracked inputs: ${untracked.join(', ')}`)
  // The omission rests on the import directions the boundary check enforces, and on every browser
  // and integration harness dependency being readable. Either failing requires every job.
  try {
    const graph = inspectBoundaries(root)
    reasons.push(
      ...graph.errors,
      ...graph.unsupported,
      ...graph.testUnsupported
        .filter(({ file }) => !file.startsWith('tests/unit/'))
        .map(({ reason }) => `Unreadable harness dependency: ${reason}`),
    )
  } catch (error) {
    reasons.push(error.message)
  }
  reasons.push(...changeReasons(changes))
  const full = reasons.length > 0
  return {
    context: { base: base ?? null, head: head ?? null, event },
    source,
    untracked,
    changes,
    mode: full ? 'full' : 'affected',
    reasons: [...new Set(reasons)].sort(),
    jobs: requiredJobs(full),
  }
}

// The caller must provide trusted workflow base/head/event. Never trust context read from a
// downloaded plan. Exact rederivation checks identity, inputs, reasons and every omission.
export function verifyPlan(plan, context) {
  assert.ok(
    context &&
      typeof context.base === 'string' &&
      typeof context.head === 'string' &&
      typeof context.event === 'string',
    'Trusted base/head/event required',
  )
  assert.deepEqual(
    plan,
    createPlan(context),
    'Plan differs from current trusted source/context/selection',
  )
  return plan
}

export function trustedContext(env = process.env, root = process.cwd()) {
  const { CI_BASE_SHA: base, CI_HEAD_SHA: head, CI_EVENT_NAME: event } = env
  assert.match(head ?? '', /^[a-f0-9]{40}$/, 'Exact workflow head required')
  assert.ok(
    ['pull_request', 'push', 'workflow_dispatch'].includes(event),
    'Known CI event required',
  )
  assert.ok(event !== 'pull_request' || base, 'Pull request base required')
  assert.match(base || head, /^[a-f0-9]{40}$/, 'Exact workflow base required')
  return { root, base: base || head, head, event }
}

export function readPlan(file = '.ci-source/impact.json', context = trustedContext()) {
  return verifyPlan(JSON.parse(readFileSync(file, 'utf8')), context)
}

export const planOutputs = (plan) =>
  Object.fromEntries(Object.entries(plan.jobs).map(([id, job]) => [id, String(job.required)]))

// Native Vitest and Playwright own discovery. The unit suite always runs whole; a browser group
// runs whole or, when the plan omits its job, not at all.
export function selectedCommand(plan, command, args = []) {
  if (command === 'units') {
    assert.equal(args.length, 0)
    return ['node_modules/vitest/vitest.mjs', 'run']
  }
  assert.equal(command, 'browser', 'Unknown execution command')
  const [group, ...extra] = args
  assert.ok(Object.hasOwn(browserJobs, group), 'Unknown browser group')
  assert.ok(plan.jobs[browserJobs[group]].required, 'Cannot run an omitted browser group')
  assert.ok(
    extra.every((arg) =>
      /^(?:--project=[a-z-]+|--shard=\d+\/\d+|--list|--reporter=json)$/.test(arg),
    ),
    'Unsupported browser selector',
  )
  return ['node_modules/playwright/cli.js', 'test', ...extra]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'create') {
    assert.equal(args.length, 1, 'Output plan path required')
    const context = trustedContext()
    const plan = verifyPlan(createPlan(context), context)
    writeFileSync(args[0], JSON.stringify(plan, null, 2) + '\n')
    assert.ok(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT required')
    for (const [name, value] of Object.entries(planOutputs(plan)))
      appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
  } else {
    const plan = readPlan()
    if (command === 'verify') {
      assert.equal(args.length, 0)
      console.log(`Verified ${plan.mode} affected plan for ${plan.source.tree}`)
    } else {
      const result = spawnSync(process.execPath, selectedCommand(plan, command, args), {
        stdio: 'inherit',
        // The group argument, not the caller's environment, decides which projects Playwright loads.
        env: command === 'browser' ? { ...process.env, E2E_GROUP: args[0] } : process.env,
      })
      if (result.error) throw result.error
      assert.equal(result.status, 0, 'Selected native test execution failed')
    }
  }
}
