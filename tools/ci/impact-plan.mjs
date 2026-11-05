import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlan, verifyPlan } from '../modules/impact.mjs'
import { browserArguments } from '../modules/run.mjs'

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

export function planOutputs(plan) {
  const outputs = Object.fromEntries(
    Object.entries(plan.jobs).map(([id, job]) => [id, String(job.required)]),
  )
  for (const [group, engines] of [
    ['cms', ['chromium', 'webkit']],
    ['public', null],
  ]) {
    const total = plan.shards[group]
    assert.ok(Number.isInteger(total) && total >= 0, `Invalid ${group} shard count`)
    outputs[`${group}_shards`] = String(total)
    // Jobs.if runs before matrix expansion. A skipped job still gets a valid inert matrix.
    outputs[`${group}_matrix`] = JSON.stringify({
      ...(engines ? { engine: engines } : {}),
      shard: Array.from({ length: total || 1 }, (_, index) => index + 1),
    })
  }
  return outputs
}

export function selectedCommand(plan, command, args = []) {
  if (command === 'units') {
    assert.equal(args.length, 0)
    assert.ok(plan.tests.unit.length, 'Empty unit selection')
    return ['node_modules/vitest/vitest.mjs', 'run', ...plan.tests.unit]
  }
  assert.equal(command, 'browser', 'Unknown execution command')
  const [group, ...extra] = args
  assert.ok(Object.hasOwn(plan.tests.browser, group), 'Unknown browser group')
  assert.ok(
    extra.every((arg) =>
      /^(?:--project=[a-z-]+|--shard=\d+\/\d+|--list|--reporter=json)$/.test(arg),
    ),
    'Unsupported browser selector',
  )
  return browserArguments(plan.tests.browser[group], extra)
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
      })
      if (result.error) throw result.error
      assert.equal(result.status, 0, 'Selected native test execution failed')
    }
  }
}
