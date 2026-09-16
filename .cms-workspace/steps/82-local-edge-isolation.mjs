import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'supabase/config.toml')
  const source = readFileSync(path, 'utf8')
  const section = /\[edge_runtime\]([\s\S]*?)(?=\n\[[^\]]+\]|$)/
  const match = source.match(section)
  if (!match || !match[0].includes('policy = "per_worker"')) {
    throw new Error('Missing per_worker edge runtime policy')
  }
  const updated = match[0].replace('policy = "per_worker"', 'policy = "oneshot"')
  writeFileSync(path, source.replace(match[0], updated))
}
