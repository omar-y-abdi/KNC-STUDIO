import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public booking rollout operations', () => {
  it('tests the same expand migration set deployed by the runbook', () => {
    const script = readFileSync('tools/release/test-public-booking-stages.sh', 'utf8')
    expect(script).toContain('20260813123853_contract_public_booking_gateway.sql')
    expect(script).toContain('--workdir "$stage_root"')
    expect(script).not.toContain('db reset --version 20260813123852')
  })

  it('installs the intentionally older contract after later expand-safe migrations', () => {
    const runbook = readFileSync('docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', 'utf8')
    expect(runbook).toContain('20260823130000_classify_booking_email_delivery_failures.sql')
    expect(runbook).toContain('db push --linked --dry-run --include-all')
    expect(runbook).toContain('db push --linked --yes --include-all')
  })

  it('smokes the current request-access action instead of removed lookup action', () => {
    const smoke = readFileSync('tools/smoke-live.mjs', 'utf8')
    expect(smoke).toContain("action: 'request_access'")
    expect(smoke).not.toContain("action: 'lookup'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE !== 'expand'")
    expect(smoke).toContain("PUBLIC_BOOKING_STAGE !== 'contract'")
  })
})
