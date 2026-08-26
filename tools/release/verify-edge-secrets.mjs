import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const REQUIRED_EDGE_SECRETS = [
  'CALENDAR_STATE_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'IP_SALT',
  'PUBLIC_ACTION_HASH_SALT',
  'PUBLIC_SITE_ORIGINS',
  'RESEND_API_KEY',
  'TURNSTILE_SECRET',
  'WEBHOOK_SECRET',
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
  console.log(`Verified ${REQUIRED_EDGE_SECRETS.length} required Edge secret names for ${ref}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
