/** What public/_headers gives every deployed file and a response of any content type needs too.
 * The asset layer adds that file's headers to the files it serves, and a response that copies an
 * asset response's headers carries them. A response the Worker builds from scratch passes no file,
 * so it gets these two here; the content, frame and embedding policies of that file describe a
 * document and stay off JSON, text and redirects. tests/unit/workerHttp.test.ts keeps both values
 * equal to that file's. */
const OWN_RESPONSE_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
} as const

/** The headers of a response the Worker builds itself: `headers`, with the two above. */
export function ownHeaders(headers?: HeadersInit): Headers {
  const own = new Headers(headers)
  for (const [name, value] of Object.entries(OWN_RESPONSE_HEADERS)) own.set(name, value)
  return own
}
