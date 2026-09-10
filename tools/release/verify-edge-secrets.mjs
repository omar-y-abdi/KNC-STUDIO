import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const REQUIRED_EDGE_SECRETS = [
  'CALENDAR_STATE_SECRET',
  'CUSTOMER_GATEWAY_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'IP_SALT',
  'PUBLIC_ACTION_HASH_SALT',
  'PUBLIC_SITE_ORIGINS',
  'RESEND_API_KEY',
  'TURNSTILE_SECRET',
  'WEBHOOK_SECRET',
]

export const FORBIDDEN_EDGE_SECRETS = ['BOOKING_WEBHOOK_SECRET']

export const REQUIRED_VAULT_SECRETS = [
  'booking_confirmation_url',
  'booking_webhook_secret',
  'external_cleanup_url',
]

export function missingEdgeSecrets(payload) {
  const names = new Set(
    Array.isArray(payload?.secrets)
      ? payload.secrets
          .map((secret) => (typeof secret?.name === 'string' ? secret.name : null))
          .filter((name) => name !== null)
      : [],
  )
  return REQUIRED_EDGE_SECRETS.filter((name) => !names.has(name))
}

export function presentForbiddenEdgeSecrets(payload) {
  const names = new Set(
    Array.isArray(payload?.secrets)
      ? payload.secrets
          .map((secret) => (typeof secret?.name === 'string' ? secret.name : null))
          .filter((name) => name !== null)
      : [],
  )
  return FORBIDDEN_EDGE_SECRETS.filter((name) => names.has(name))
}

export function missingVaultSecrets(payload) {
  const names = new Set(
    Array.isArray(payload?.rows)
      ? payload.rows
          .map((secret) =>
            typeof secret?.name === 'string' && secret.configured === true ? secret.name : null,
          )
          .filter((name) => name !== null)
      : [],
  )
  return REQUIRED_VAULT_SECRETS.filter((name) => !names.has(name))
}

export function webhookSecretDigestsMatch(edgePayload, vaultPayload) {
  const edgeDigest = Array.isArray(edgePayload?.secrets)
    ? edgePayload.secrets.find((secret) => secret?.name === 'WEBHOOK_SECRET')?.value
    : undefined
  const vaultDigest = Array.isArray(vaultPayload?.rows)
    ? vaultPayload.rows.find((secret) => secret?.name === 'booking_webhook_secret')?.value_digest
    : undefined
  const sha256 = /^[0-9a-f]{64}$/i
  return typeof edgeDigest === 'string' &&
    sha256.test(edgeDigest) &&
    typeof vaultDigest === 'string' &&
    sha256.test(vaultDigest)
    ? edgeDigest === vaultDigest
    : false
}

function projectRef() {
  const flagIndex = process.argv.indexOf('--project-ref')
  const fromFlag = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined
  const value = fromFlag ?? process.env.PROJECT_REF
  if (typeof value !== 'string' || !/^[a-z]{20}$/.test(value)) {
    throw new Error('Set PROJECT_REF or pass --project-ref <20-letter Supabase project ref>.')
  }
  return value
}

export function main() {
  const ref = projectRef()
  const result = spawnSync(
    'npx',
    ['supabase', 'secrets', 'list', '--project-ref', ref, '--output-format', 'json'],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error('Could not list Supabase Edge secret names. Check CLI authentication.')
  }

  let payload
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    throw new Error('Supabase CLI returned an unreadable secret-name response.')
  }
  const missing = missingEdgeSecrets(payload)
  if (missing.length > 0) {
    throw new Error(`Missing required Supabase Edge secrets: ${missing.join(', ')}`)
  }
  const forbidden = presentForbiddenEdgeSecrets(payload)
  if (forbidden.length > 0) {
    throw new Error(`Remove forbidden legacy Supabase Edge secrets: ${forbidden.join(', ')}`)
  }

  const vaultQuery = [
    'select name,',
    'decrypted_secret is not null and length(decrypted_secret) > 0 as configured,',
    "encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') as value_digest",
    'from vault.decrypted_secrets',
    `where name in (${REQUIRED_VAULT_SECRETS.map((name) => `'${name}'`).join(',')})`,
    'order by name;',
  ].join(' ')
  const vaultResult = spawnSync(
    'npx',
    [
      'supabase',
      'db',
      'query',
      '--linked',
      '--project-ref',
      ref,
      '--output-format',
      'json',
      vaultQuery,
    ],
    { encoding: 'utf8' },
  )
  if (vaultResult.status !== 0) {
    throw new Error('Could not verify Supabase Vault secret names. Check CLI authentication.')
  }

  let vaultPayload
  try {
    vaultPayload = JSON.parse(vaultResult.stdout)
  } catch {
    throw new Error('Supabase CLI returned an unreadable Vault secret-name response.')
  }
  const missingVault = missingVaultSecrets(vaultPayload)
  if (missingVault.length > 0) {
    throw new Error(`Missing required Supabase Vault secrets: ${missingVault.join(', ')}`)
  }
  if (!webhookSecretDigestsMatch(payload, vaultPayload)) {
    throw new Error('Supabase Edge WEBHOOK_SECRET does not match Vault booking_webhook_secret.')
  }

  console.log(
    `Verified ${REQUIRED_EDGE_SECRETS.length} Edge and ${REQUIRED_VAULT_SECRETS.length} Vault secret names for ${ref}.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
