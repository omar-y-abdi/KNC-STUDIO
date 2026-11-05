// Pure helpers the public Supabase clients share: request headers, project URLs and the Storage
// object URL. Nothing here imports a Supabase library, so any chunk may use it without paying for one.

import { SUPABASE_URL } from './config'

export const BACKEND_NOT_CONFIGURED =
  'Supabase backend is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
  '(or use the offline mock adapters, which require no env).'

/**
 * Legacy anon keys are JWTs. PostgREST applies RLS from Authorization, not from the apikey header.
 * New publishable keys are opaque and must not be sent as bearer tokens.
 */
export function isJwtShaped(key: string): boolean {
  return key.split('.').length === 3
}

/** Headers of every public Data API request. */
export function publicApiHeaders(key: string): Record<string, string> {
  return isJwtShaped(key) ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }
}

const withTrailingSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`)

/** The PostgREST root of a project; a path prefix on the project URL (the local TLS bridge) stays. */
export function restUrl(projectUrl: string): string {
  return new URL('rest/v1', withTrailingSlash(projectUrl)).href
}

/** The Realtime root of a project over `ws(s)`, derived the way supabase-js derives it. */
export function realtimeUrl(projectUrl: string): string {
  const url = new URL('realtime/v1', withTrailingSlash(projectUrl))
  url.protocol = url.protocol.replace('http', 'ws')
  return url.href
}

/** Public URL of a Storage object, byte-identical to the one storage-js `getPublicUrl` builds. */
export function storageObjectUrl(projectUrl: string, bucket: string, path: string): string {
  const storage = new URL('storage/v1', withTrailingSlash(projectUrl)).href
  return encodeURI(`${storage}/object/public/${bucket}/${path.replace(/^\/+/, '')}`)
}

/** `storageObjectUrl` for the configured project. */
export function publicObjectUrl(bucket: string, path: string): string {
  if (SUPABASE_URL === undefined) throw new Error(BACKEND_NOT_CONFIGURED)
  return storageObjectUrl(SUPABASE_URL, bucket, path)
}
