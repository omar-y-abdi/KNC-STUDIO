import { describe, expect, it } from 'vitest'
import {
  REQUIRED_EDGE_SECRETS,
  missingEdgeSecrets,
} from '../../tools/release/verify-edge-secrets.mjs'

describe('production Edge secret preflight', () => {
  it('requires every runtime dependency, including customer-access salt', () => {
    expect(REQUIRED_EDGE_SECRETS).toContain('PUBLIC_ACTION_HASH_SALT')
    expect(REQUIRED_EDGE_SECRETS).toContain('TURNSTILE_SECRET')
    expect(REQUIRED_EDGE_SECRETS).toContain('WEBHOOK_SECRET')
  })

  it('reports names only and accepts a complete CLI response', () => {
    const complete = {
      secrets: REQUIRED_EDGE_SECRETS.map((name) => ({ name, value: 'never-inspected-digest' })),
    }
    expect(missingEdgeSecrets(complete)).toEqual([])
    expect(
      missingEdgeSecrets({
        secrets: complete.secrets.filter((secret) => secret.name !== 'IP_SALT'),
      }),
    ).toEqual(['IP_SALT'])
  })
})
