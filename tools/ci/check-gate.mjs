import assert from 'node:assert/strict'

// A protected context passes only when every job it needs succeeded: a failed, cancelled, skipped
// or absent job fails it.
const expected = process.argv.slice(2)
const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}')
assert.ok(expected.length > 0, 'Gate must declare its dependencies')
assert.equal(new Set(expected).size, expected.length, 'Duplicate gate dependencies')
assert.deepEqual(
  Object.keys(needs).sort(),
  [...expected].sort(),
  'Missing or unexpected gate dependencies',
)
for (const name of expected)
  assert.equal(needs[name].result, 'success', `${name}: ${needs[name].result}`)
console.log(`Verified ${expected.join(', ')}`)
