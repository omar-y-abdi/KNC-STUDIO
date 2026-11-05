import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceIdentity } from '../ci/build-artifact.mjs'
import { inspectBoundaries, repositoryRoot } from './boundaries.mjs'
import { git, jobs, loadInventory, selectVerification, unitOwnership } from './model.mjs'

function validCommit(root, value) {
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) return false
  try {
    return git(root, ['rev-parse', `${value}^{commit}`]) === value
  } catch {
    return false
  }
}

export function changedPaths(root, base, tree) {
  const fields = git(root, ['diff', '--name-status', '--no-renames', '-z', base, tree]).split('\0')
  const result = []
  for (let index = 0; index + 1 < fields.length; index += 2)
    result.push({ status: fields[index], path: fields[index + 1] })
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

export function createPlan({ root = repositoryRoot, base, head, event = 'local' } = {}) {
  const source = sourceIdentity(root)
  const forced = []
  const baseValid = validCommit(root, base)
  const headValid = validCommit(root, head) && head === source.commit
  if (!baseValid) forced.push('Missing or invalid exact base commit')
  if (!headValid) forced.push('Missing, invalid or stale exact head commit')
  if (!['pull_request', 'local'].includes(event)) forced.push(`Full verification event: ${event}`)
  if (baseValid && headValid) {
    try {
      git(root, ['merge-base', '--is-ancestor', base, head])
    } catch {
      forced.push('Base is not an ancestor of the checked-out head')
    }
  }
  const changes = baseValid ? changedPaths(root, base, source.tree) : []
  // The shared artifact identity intentionally covers tracked files. Untracked input can never
  // authorize omissions; record it separately so changes cannot hide behind that identity.
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort()
  if (untracked.length) forced.push(`Untracked inputs: ${untracked.join(', ')}`)
  let graph
  try {
    graph = inspectBoundaries(root)
  } catch (error) {
    graph = { files: [], edges: [], errors: [error.message], unsupported: [] }
  }
  forced.push(...graph.errors, ...graph.unsupported)
  const { inventory, errors } = loadInventory(root)
  forced.push(...errors)
  const units = unitOwnership(root, inventory, graph)
  const selection = selectVerification(changes, graph, inventory, units, forced)
  const result = {
    schemaVersion: 1,
    context: { base: base ?? null, head: head ?? null, event },
    source,
    untracked,
    changes,
    ...selection,
  }
  validatePlan(result)
  return result
}

export function validatePlan(plan) {
  assert.ok(plan && typeof plan === 'object', 'Plan must be an object')
  assert.equal(plan.schemaVersion, 1, 'Unsupported plan schema')
  assert.ok(['full', 'affected'].includes(plan.mode), 'Invalid plan mode')
  assert.deepEqual(Object.keys(plan.jobs).sort(), [...jobs].sort(), 'Missing/extra jobs')
  for (const job of jobs) {
    assert.equal(typeof plan.jobs[job].required, 'boolean', `Invalid job ${job}`)
    assert.ok(
      typeof plan.jobs[job].reason === 'string' && plan.jobs[job].reason.length,
      `Missing job reason ${job}`,
    )
  }
  assert.match(plan.source.commit, /^[a-f0-9]{40}$/)
  assert.match(plan.source.tree, /^[a-f0-9]{40}$/)
  for (const paths of [
    plan.tests.unit,
    plan.tests.integration,
    ...Object.values(plan.tests.browser),
  ]) {
    assert.ok(
      Array.isArray(paths) && paths.every((path) => typeof path === 'string'),
      'Invalid test selection',
    )
    assert.deepEqual(paths, [...new Set(paths)].sort(), 'Test selections must be sorted and unique')
  }
  assert.ok(plan.tests.unit.length, 'Empty unit selection')
  for (const [group, job] of Object.entries({
    cms: 'cms',
    public: 'public-browsers',
    startup: 'startup',
    customer: 'database-current',
  })) {
    assert.equal(
      plan.tests.browser[group].length > 0,
      plan.jobs[job].required,
      `Empty or unauthorized ${group} selection`,
    )
  }
  assert.equal(
    plan.tests.integration.length > 0,
    plan.jobs['database-current'].required,
    'Empty or unauthorized database integration selection',
  )
  for (const [group, job] of Object.entries({
    cms: 'cms',
    public: 'public-browsers',
    startup: 'startup',
  })) {
    assert.ok(
      Number.isInteger(plan.shards[group]) && plan.shards[group] >= 0,
      `Invalid ${group} shard count`,
    )
    assert.equal(
      plan.shards[group] > 0,
      plan.jobs[job].required,
      `Empty or unauthorized ${group} shards`,
    )
  }
  return plan
}

// The caller must provide trusted workflow base/head/event. Never trust context read from a
// downloaded plan. Exact rederivation checks schema, identity, inputs, reasons and every omission.
export function verifyPlan(plan, context) {
  assert.ok(
    context &&
      typeof context.base === 'string' &&
      typeof context.head === 'string' &&
      typeof context.event === 'string',
    'Trusted base/head/event required',
  )
  validatePlan(plan)
  assert.deepEqual(
    plan,
    createPlan(context),
    'Plan differs from current trusted source/context/selection',
  )
  return plan
}

export function authorizeOmission(plan, job, context) {
  verifyPlan(plan, context)
  assert.ok(jobs.includes(job), `Unknown job ${job}`)
  assert.equal(plan.jobs[job].required, false, `Required job cannot be omitted: ${job}`)
}

export function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    assert.ok(
      ['--base', '--head', '--event', '--file', '--job', '--group'].includes(name) &&
        args[index + 1],
      `Unknown/incomplete option ${name}`,
    )
    assert.ok(!Object.hasOwn(options, name.slice(2)), `Duplicate option ${name}`)
    options[name.slice(2)] = args[index + 1]
  }
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  const options = parseOptions(args)
  if (command === 'create') {
    const plan = createPlan(options)
    const json = JSON.stringify(plan, null, 2) + '\n'
    if (options.file) writeFileSync(options.file, json)
    else process.stdout.write(json)
  } else {
    assert.ok(options.file, '--file required')
    const plan = verifyPlan(JSON.parse(readFileSync(options.file, 'utf8')), options)
    if (command === 'verify')
      console.log(`Verified ${plan.mode} plan for ${plan.source.commit}/${plan.source.tree}`)
    else if (command === 'omit') authorizeOmission(plan, options.job, options)
    else if (command === 'units') console.log(plan.tests.unit.join('\n'))
    else if (command === 'browser') {
      assert.ok(Object.hasOwn(plan.tests.browser, options.group), 'Known --group required')
      assert.ok(plan.tests.browser[options.group].length, 'Cannot run an omitted browser group')
      console.log(plan.tests.browser[options.group].join('\n'))
    } else throw new Error(`Unknown plan command: ${command}`)
  }
}
