import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_EDGE_SECRETS,
  REQUIRED_EDGE_SECRETS,
  REQUIRED_VAULT_SECRETS,
  missingEdgeSecrets,
  missingVaultSecrets,
  presentForbiddenEdgeSecrets,
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

  it('rejects legacy Edge secret names that can restore split-secret drift', () => {
    expect(FORBIDDEN_EDGE_SECRETS).toEqual(['BOOKING_WEBHOOK_SECRET'])
    expect(
      presentForbiddenEdgeSecrets({
        secrets: [...REQUIRED_EDGE_SECRETS, 'BOOKING_WEBHOOK_SECRET'].map((name) => ({ name })),
      }),
    ).toEqual(['BOOKING_WEBHOOK_SECRET'])
    expect(
      presentForbiddenEdgeSecrets({
        secrets: REQUIRED_EDGE_SECRETS.map((name) => ({ name })),
      }),
    ).toEqual([])
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
    const digest = 'a'.repeat(64)
    const edge = { secrets: [{ name: 'WEBHOOK_SECRET', value: digest }] }
    const vault = {
      rows: [
        {
          name: 'booking_webhook_secret',
          configured: true,
          value_digest: digest,
        },
      ],
    }
    expect(webhookSecretDigestsMatch(edge, vault)).toBe(true)
    expect(
      webhookSecretDigestsMatch(edge, {
        rows: [{ ...vault.rows[0], value_digest: 'b'.repeat(64) }],
      }),
    ).toBe(false)
    expect(webhookSecretDigestsMatch({ secrets: [] }, vault)).toBe(false)
    expect(
      webhookSecretDigestsMatch(
        { secrets: [{ name: 'WEBHOOK_SECRET', value: 'not-a-digest' }] },
        { rows: [{ ...vault.rows[0], value_digest: 'not-a-digest' }] },
      ),
    ).toBe(false)
  })
})
