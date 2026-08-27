import { describe, expect, it } from 'vitest'
import {
  REQUIRED_EDGE_SECRETS,
  REQUIRED_VAULT_SECRETS,
  missingEdgeSecrets,
  missingVaultSecrets,
  webhookSecretDigestsMatch,
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

  it('requires every database Vault dependency used by cron dispatchers', () => {
    expect(REQUIRED_VAULT_SECRETS).toEqual([
      'booking_confirmation_url',
      'booking_webhook_secret',
      'external_cleanup_url',
    ])
  })

  it('reports a missing external cleanup URL without inspecting secret values', () => {
    const complete = {
      rows: REQUIRED_VAULT_SECRETS.map((name) => ({ name, configured: true })),
    }
    expect(missingVaultSecrets(complete)).toEqual([])
    expect(
      missingVaultSecrets({
        rows: complete.rows.filter((secret) => secret.name !== 'external_cleanup_url'),
      }),
    ).toEqual(['external_cleanup_url'])
    expect(
      missingVaultSecrets({
        rows: complete.rows.map((secret) =>
          secret.name === 'booking_webhook_secret' ? { ...secret, configured: false } : secret,
        ),
      }),
    ).toEqual(['booking_webhook_secret'])
  })

  it('requires the Edge and Vault webhook secret digests to match', () => {
    const edge = { secrets: [{ name: 'WEBHOOK_SECRET', value: 'same-sha256' }] }
    const vault = {
      rows: [
        {
          name: 'booking_webhook_secret',
          configured: true,
          value_digest: 'same-sha256',
        },
      ],
    }
    expect(webhookSecretDigestsMatch(edge, vault)).toBe(true)
    expect(
      webhookSecretDigestsMatch(edge, {
        rows: [{ ...vault.rows[0], value_digest: 'different-sha256' }],
      }),
    ).toBe(false)
    expect(webhookSecretDigestsMatch({ secrets: [] }, vault)).toBe(false)
  })
})
