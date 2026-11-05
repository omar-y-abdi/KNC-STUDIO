import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPlan } from './impact-plan.mjs'

export function checkGate(expected, needs, plan) {
  assert.ok(expected.length > 0, 'Gate must declare its dependencies')
  assert.equal(new Set(expected).size, expected.length, 'Duplicate gate dependencies')
  assert.deepEqual(
    Object.keys(needs).sort(),
    [...expected].sort(),
    'Missing or unexpected gate dependencies',
  )
  for (const name of expected) {
    if (plan) assert.ok(Object.hasOwn(plan.jobs, name), `Unknown planned dependency ${name}`)
    const required = !plan || plan.jobs[name].required || ['format', 'quality'].includes(name)
    const result = needs[name].result
    assert.ok(
      result === 'success' || (!required && result === 'skipped'),
      `${name}: ${result}; ${required ? 'required' : 'omission authorized'}`,
    )
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const planned = args[0] === '--plan'
  const expected = planned ? args.slice(1) : args
  // No plan retains the original strict all-success contract. Plan mode always rederives from
  // the downloaded formatted source and trusted workflow context before permitting any skip.
  checkGate(expected, JSON.parse(process.env.NEEDS_JSON ?? '{}'), planned ? readPlan() : undefined)
  console.log(`Verified ${expected.join(', ')}`)
}
