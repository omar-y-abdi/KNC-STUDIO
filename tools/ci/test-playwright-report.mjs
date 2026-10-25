import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyReport } from './verify-playwright-report.mjs'

const plan = {
  suites: [
    {
      specs: [
        { id: 'a', tests: [{ projectName: 'chromium', expectedStatus: 'passed' }] },
        { id: 'b', tests: [{ projectName: 'webkit', expectedStatus: 'passed' }] },
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

// The guard's hostile probes deliberately fail in teardown. Only failures declared in the
// discovered plan may count as expected outcomes; a report cannot opt itself into failure.
test('planned failure probes pass only when they execute once and fail as declared', () => {
  const expected = globalThis.structuredClone(plan)
  expected.suites[0].specs[0].tests[0].annotations = [{ type: 'fail' }]
  const report = successful()
  const probe = report.suites[0].specs[0].tests[0]
  probe.expectedStatus = 'failed'
  probe.annotations = [{ type: 'fail' }]
  probe.results[0].status = 'failed'
  assert.equal(verifyReport(expected, report), 2)
  assert.throws(() => verifyReport(plan, report), /expected status changed/)

  for (const status of ['passed', 'skipped', 'timedOut', 'interrupted']) {
    probe.results[0].status = status
    assert.throws(() => verifyReport(expected, report))
  }
  probe.results[0].status = 'failed'
  probe.results.push({ status: 'failed' })
  assert.throws(() => verifyReport(expected, report), /exactly one execution/)
})

test('unsupported planned statuses cannot authorise skipped or interrupted executions', () => {
  for (const status of ['skipped', 'timedOut', 'interrupted', undefined]) {
    const expected = globalThis.structuredClone(plan)
    expected.suites[0].specs[0].tests[0].expectedStatus = status
    const report = successful()
    report.suites[0].specs[0].tests[0].expectedStatus = status
    report.suites[0].specs[0].tests[0].results[0].status = status
    assert.throws(() => verifyReport(expected, report), /unsupported planned status/)
  }
})

test('discovery skip and fixme annotations cannot disable an assigned case', () => {
  for (const type of ['skip', 'fixme']) {
    const expected = globalThis.structuredClone(plan)
    expected.suites[0].specs[0].tests[0].annotations = [{ type }]
    assert.throws(() => verifyReport(expected, successful()), /planned case is disabled/)
  }
})
