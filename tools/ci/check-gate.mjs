import assert from 'node:assert/strict'

// Protected contexts must never pass on skipped, cancelled, failed or absent jobs.
const expected = process.argv.slice(2).sort()
const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}')
assert.ok(expected.length > 0, 'Gate must declare its dependencies')
assert.deepEqual(Object.keys(needs).sort(), expected, 'Missing or unexpected gate dependencies')
for (const name of expected)
  assert.equal(needs[name].result, 'success', `${name}: ${needs[name].result}`)
console.log(`Verified ${expected.join(', ')}`)
