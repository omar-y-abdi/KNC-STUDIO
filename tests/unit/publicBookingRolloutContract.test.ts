import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('public booking rollout operations', () => {
  const expandAfterBaseline = [
    '20260831222332_customer_access_outbox_ciphertext.sql',
    '20260831220511_decimal_service_prices_and_duration_contract.sql',
    '20260831221442_service_ordering_contract.sql',
    '20260901013601_calendar_customer_contact_payload.sql',
    '20260901014248_relocate_btree_gist_to_extensions.sql',
    '20260902005645_calendar_reassignment_cleanup.sql',
    '20260905154608_customer_http_only_session.sql',
    '20260902010333_update_confirm_sent_secure_link_copy.sql',
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

  it('keeps Expand and Contract smoke expectations distinct', () => {
    const smoke = readFileSync('tools/smoke-live.mjs', 'utf8')
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE === 'expand'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE === 'contract'")
    expect(smoke).toContain('status === 404')
  })

  it('keeps the staging worktree isolated from the source tree', () => {
    const script = readFileSync('tools/release/test-public-booking-stages.sh', 'utf8')
    expect(script).toContain('--workdir "$stage_root"')
    expect(script).toContain('mktemp -d')
  })

  it('smokes the current request-access action instead of removed lookup action', () => {
    const smoke = readFileSync('tools/smoke-live.mjs', 'utf8')
    expect(smoke).toContain("action: 'request_access'")
    expect(smoke).not.toContain("action: 'lookup'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE !== 'expand'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE !== 'contract'")
  })
})
