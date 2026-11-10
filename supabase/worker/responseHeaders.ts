/** public/_headers' values every response needs (tests/unit/workerHttp.test.ts keeps them equal).
 * The asset layer adds that file only to what it serves; its document policies stay off JSON, text
 * and redirects. */
const OWN_RESPONSE_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
} as const

export function ownHeaders(headers?: HeadersInit): Headers {
  const own = new Headers(headers)
  for (const [name, value] of Object.entries(OWN_RESPONSE_HEADERS)) own.set(name, value)
  return own
}
