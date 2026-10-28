import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function cases(report) {
  const result = []
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        result.push({ id: `${spec.id}/${test.projectName}/${test.repeatEachIndex ?? 0}`, test })
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites ?? []) visit(suite)
  return result
}

export function verifyReport(expected, actual) {
  const planned = cases(expected)
  const completed = cases(actual)
  assert.ok(planned.length > 0, 'No browser tests were discovered')
  assert.equal(
    new Set(planned.map((row) => row.id)).size,
    planned.length,
    'Duplicate planned cases',
  )
  assert.deepEqual(
    completed.map((row) => row.id).sort(),
    planned.map((row) => row.id).sort(),
    'Missing or unexpected browser results',
  )
  assert.deepEqual(actual.errors ?? [], [], 'Browser runner errors')
  const plannedById = new Map(planned.map(({ id, test }) => [id, test]))
  for (const { id, test } of completed) {
    const plannedTest = plannedById.get(id)
    assert.ok(
      plannedTest.expectedStatus === 'passed' || plannedTest.expectedStatus === 'failed',
      `${id}: unsupported planned status ${plannedTest.expectedStatus}`,
    )
    assert.ok(
      !(plannedTest.annotations ?? []).some(({ type }) => type === 'skip' || type === 'fixme'),
      `${id}: planned case is disabled`,
    )
    // --list records describe-level test.fail() as an annotation before the runner applies it
    // to expectedStatus. Only the discovery plan may authorise an intentional failed execution.
    const expectedStatus = (plannedTest.annotations ?? []).some(({ type }) => type === 'fail')
      ? 'failed'
      : plannedTest.expectedStatus
    assert.equal(test.expectedStatus, expectedStatus, `${id}: expected status changed`)
    assert.equal(test.status, 'expected', `${id}: ${test.status}`)
    assert.equal(test.results.length, 1, `${id}: expected exactly one execution`)
    assert.equal(test.results[0].status, expectedStatus, `${id}: ${test.results[0].status}`)
  }
  assert.equal(actual.stats.expected, planned.length)
  for (const field of ['skipped', 'unexpected', 'flaky'])
    assert.equal(actual.stats[field], 0, field)
  return planned.length
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planned, completed] = await Promise.all(
    process.argv.slice(2).map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
  )
  console.log(
    `Verified ${verifyReport(planned, completed)} browser cases; no skips, retries or missing outcomes`,
  )
}
