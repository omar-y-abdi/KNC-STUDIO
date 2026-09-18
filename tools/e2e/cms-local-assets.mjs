import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function localCmsHeaders(source, backend) {
  const url = new URL(backend)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Only an isolated local Supabase URL is allowed for the browser fixture.')
  const origin = url.origin,
    websocket = origin.replace('http:', 'ws:')
  let policies = 0
  const value = source.replace(
    /(Content-Security-Policy:\s*)([^\n]+)/gi,
    (_line, prefix, policy) => {
      policies++
      const directives = policy
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
      const result = directives
        .filter((item) => item !== 'upgrade-insecure-requests')
        .map((item) => {
          const [name, ...sources] = item.split(/\s+/)
          if (['connect-src', 'img-src', 'font-src'].includes(name)) {
            const selected = sources.filter(
              (value) => value !== 'https://*.supabase.co' && value !== 'wss://*.supabase.co',
            )
            selected.push(origin)
            if (name === 'connect-src') selected.push(websocket)
            return `${name} ${[...new Set(selected)].join(' ')}`
          }
          return item
        })
      return prefix + result.join('; ')
    },
  )
  if (
    !policies ||
    !value.includes("script-src 'self'") ||
    !value.includes("object-src 'none'") ||
    !value.includes("frame-ancestors 'none'")
  )
    throw new Error('The fixture must retain the production script, embedding and object policies.')
  return value
}

export function prepareLocalCmsAssets(backend) {
  const source = resolve('dist'),
    target = resolve('artifacts/cms-browser/local-assets')
  const original = readFileSync(resolve(source, '_headers'), 'utf8')
  const headers = localCmsHeaders(original, backend)
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })
  writeFileSync(resolve(target, '_headers'), headers)
  if (readFileSync(resolve(source, '_headers'), 'utf8') !== original)
    throw new Error('Production asset headers must remain unchanged.')
  return target
}
