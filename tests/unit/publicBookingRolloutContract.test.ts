import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('public booking rollout operations', () => {
  const expandAfterBaseline = [
    '20260831220511_decimal_service_prices_and_duration_contract.sql',
    '20260831221442_service_ordering_contract.sql',
    '20260901013601_calendar_customer_contact_payload.sql',
    '20260901014248_relocate_btree_gist_to_extensions.sql',
    '20260902005645_calendar_reassignment_cleanup.sql',
    '20260905154608_customer_http_only_session.sql',
  ]
  const contractAfterBaseline = [
    ...expandAfterBaseline,
    '20260901011632_retire_taken_slots_contract.sql',
    '20260901011908_retire_legacy_customer_lookup_overloads.sql',
    '20260901012503_retire_superseded_booking_contracts.sql',
  ]

  function stage(mode: 'expand' | 'contract'): string[] {
    const stageRoot = mkdtempSync(join(tmpdir(), 'blade-booking-rollout-'))
    const target = join(stageRoot, 'supabase')
    try {
      const result = spawnSync(
        'bash',
        [
          '-c',
          [
            'set -euo pipefail',
            'source "$PWD/tools/release/public-booking-migration-stages.sh"',
            `public_booking_stage_migrations ${mode} "$PWD/supabase" "$STAGE_TARGET"`,
          ].join('\n'),
        ],
        { cwd: process.cwd(), env: { ...process.env, STAGE_TARGET: target }, encoding: 'utf8' },
      )
      expect(result.status, result.stderr).toBe(0)
      return readdirSync(join(target, 'migrations')).sort()
    } finally {
      rmSync(stageRoot, { recursive: true, force: true })
    }
  }

  it('uses one executable migration selector for the runbook and CI harness', () => {
    const script = readFileSync('tools/release/test-public-booking-stages.sh', 'utf8')
    const runbook = readFileSync('docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', 'utf8')
    expect(script).toContain('public_booking_stage_migrations expand')
    expect(script).toContain('public_booking_stage_migrations contract')
    expect(runbook).toContain('public_booking_stage_migrations expand')
    expect(runbook).toContain('public_booking_stage_migrations contract')
  })

  it('stages only reviewed post-baseline migrations at each rollout boundary', () => {
    const expand = stage('expand').filter((name) =>
      /^20260905|^20260831|^20260901|^20260902/.test(name),
    )
    const contract = stage('contract').filter((name) =>
      /^20260905|^20260831|^20260901|^20260902/.test(name),
    )
    expect(expand).toEqual(expandAfterBaseline.sort())
    expect(contract).toEqual(contractAfterBaseline.sort())
  })

  it('records the verified remote baseline and defers every irreversible retirement', () => {
    const runbook = readFileSync('docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', 'utf8')
    expect(runbook).toContain('20260827170300')
    expect(runbook).toContain('20260813123853_contract_public_booking_gateway.sql')
    expect(runbook).toContain('20260901011632_retire_taken_slots_contract.sql')
    expect(runbook).toContain('20260901011908_retire_legacy_customer_lookup_overloads.sql')
    expect(runbook).toContain('20260901012503_retire_superseded_booking_contracts.sql')
    expect(runbook).toContain('20260902005645_calendar_reassignment_cleanup.sql')
    expect(runbook).toContain('mapped_tokens=1')
    expect(runbook).toContain('mapped_tokens_without_email=0')
  })

  it('distinguishes already-denied Expand access from Contract function absence', () => {
    const runbook = readFileSync('docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', 'utf8')
    const smoke = readFileSync('tools/smoke-live.mjs', 'utf8')
    expect(runbook).toContain('Expand smoke')
    expect(runbook).toContain('HTTP 401 or 403')
    expect(runbook).toContain('Contract smoke')
    expect(runbook).toContain('HTTP 404')
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE === 'expand'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE === 'contract'")
    expect(smoke).toContain('status === 404')
  })

  it('documents forward-only recovery after retirement and reads the baseline ACL', () => {
    const runbook = readFileSync('docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', 'utf8')
    expect(runbook).toContain('secure-gateway-compatible')
    expect(runbook).toContain('never regrant anonymous access')
    expect(runbook).toContain('already part of the verified baseline')
    expect(runbook).toContain('read back its existing ACL')
    expect(runbook).not.toContain('legacy RPC clients remain available')
    expect(runbook).not.toContain(
      'After deploying any later function-privilege hardening migration',
    )
  })

  it('keeps the staging worktree isolated from the source tree', () => {
    const script = readFileSync('tools/release/test-public-booking-stages.sh', 'utf8')
    expect(script).toContain('--workdir "$stage_root"')
    expect(script).toContain('mktemp -d')
  })

  it('keeps the already-live gateway contract out of the pending retirement set', () => {
    const runbook = readFileSync('docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', 'utf8')
    expect(runbook).toContain('20260827170300_harden_internal_function_privileges.sql')
    expect(runbook).toContain('20260813123853_contract_public_booking_gateway.sql')
    expect(runbook).toContain('20260901011632_retire_taken_slots_contract.sql')
    expect(runbook).toContain('db push --linked --dry-run --include-all --workdir "$contract_root"')
    expect(runbook).toContain('db push --linked --yes --include-all --workdir "$contract_root"')
    expect(runbook).not.toContain('db push --linked --dry-run --include-all --workdir "$PWD"')
    expect(runbook).not.toContain('db push --linked --yes --include-all --workdir "$PWD"')
  })

  it('deploys the customer outbox contract before the retired-RPC cleanup', () => {
    const runbook = readFileSync('docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', 'utf8')
    const customerOutbox = runbook.indexOf('20260831222332_customer_access_outbox_ciphertext.sql')
    const retirement = runbook.indexOf('database PR #48')

    expect(customerOutbox).toBeGreaterThan(-1)
    expect(retirement).toBeGreaterThan(customerOutbox)
    expect(runbook).toContain('Merge/deploy PR #55 before database PR #48')
  })

  it('smokes the current request-access action instead of removed lookup action', () => {
    const smoke = readFileSync('tools/smoke-live.mjs', 'utf8')
    expect(smoke).toContain("action: 'request_access'")
    expect(smoke).not.toContain("action: 'lookup'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE !== 'expand'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE !== 'contract'")
  })
})
