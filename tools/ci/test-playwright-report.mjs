import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyReport } from './verify-playwright-report.mjs'

const plan = {
  suites: [
    {
      specs: [
        { id: 'a', tests: [{ projectName: 'chromium' }] },
        { id: 'b', tests: [{ projectName: 'webkit' }] },
      ],
    },
  ],
}
function successful() {
  const report = globalThis.structuredClone(plan)
  for (const spec of report.suites[0].specs)
    for (const row of spec.tests)
      Object.assign(row, { status: 'expected', results: [{ status: 'passed' }] })
  report.stats = { expected: 2, skipped: 0, unexpected: 0, flaky: 0 }
  return report
}

test('complete native outcomes pass; omitted, duplicated, skipped, failed and retried cases fail', () => {
  assert.equal(verifyReport(plan, successful()), 2)
  const mutations = [
    (r) => r.suites[0].specs.pop(),
    (r) => r.suites[0].specs.push(r.suites[0].specs[0]),
    (r) => {
      r.suites[0].specs[0].tests[0].status = 'skipped'
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = 'failed'
    },
    (r) => r.suites[0].specs[0].tests[0].results.push({ status: 'passed' }),
    (r) => {
      r.stats.expected = 1
    },
    (r) => {
      r.errors = [{ message: 'global setup failed' }]
    },
  ]
  for (const mutate of mutations) {
    const report = successful()
    mutate(report)
    assert.throws(() => verifyReport(plan, report))
  }
  assert.throws(() => verifyReport({ suites: [] }, successful()))
})
