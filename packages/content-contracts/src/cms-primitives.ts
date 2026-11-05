// Vocabulary and checks that cms.ts and email-design.ts share. Kept apart so the email path (every
// Edge Function that sends mail) loads these few lines instead of the whole document validator.
export type CmsLang = 'sv' | 'en'
export type CmsMode = 'light' | 'dark'

export type MediaBucket = 'gallery' | 'barber-photos' | 'cms-library'
export interface MediaRef {
  bucket: MediaBucket
  path: string
}

export class CmsValidationError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'CmsValidationError'
    this.path = path
  }
}

export function fail(path: string, message: string): never {
  throw new CmsValidationError(path, message)
}

export function object(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    fail(path, 'Expected an object')
  return value as Record<string, unknown>
}

export function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'Unsupported field')
}

export function integer(value: unknown, path: string, min: number, max: number): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail(path, `Expected an integer between ${min} and ${max}`)
}

export function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `Expected at most ${max} items`)
  return value
}

export function validMediaRef(value: unknown): value is MediaRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  return (
    Object.keys(ref).every((key) => key === 'bucket' || key === 'path') &&
    ['gallery', 'barber-photos', 'cms-library'].includes(String(ref['bucket'])) &&
    typeof ref['path'] === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$/.test(ref['path']) &&
    !ref['path'].includes('..') &&
    !ref['path'].includes('//')
  )
}
