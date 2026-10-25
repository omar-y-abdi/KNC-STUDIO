import { describe, expect, it } from 'vitest'
import { z } from 'zod/v3'
import { parseReview } from '../../src/about/reviewValidation'
import {
  normalizePhone,
  parseEmail,
  parseName,
  parsePhone,
  type ValidationResult,
} from '../../src/booking/validation'

// The public form checks used to be zod schemas. The schemas below are those schemas, verbatim,
// kept only as the oracle: the plain functions must accept, reject, normalise and word every
// input exactly as they did. The explicitly historical v3 oracle is test-only; production
// boundaries use the patched v4 API. Upgrading this oracle would redefine the old form contract.
const nameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'Name is required').max(80, 'Name is too long'))
const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^07\d{8}$/, 'Invalid Swedish mobile number'))
const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().email('Invalid email address').max(254, 'Email is too long'))
const reviewTextSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'Review text is required').max(600, 'Review text is too long'))

interface Oracle {
  safeParse(data: unknown): z.SafeParseReturnType<string, string>
}

/** The first zod issue becomes the message, as the old `toResult` did. */
function oracle(schema: Oracle, raw: string): ValidationResult<string> {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  const first = parsed.error.issues[0]
  return { ok: false, error: first ? first.message : 'Invalid value' }
}

/** Every string of up to `maxLength` tokens, shortest first. */
function* sequences(tokens: readonly string[], maxLength: number): Generator<string> {
  yield ''
  let frontier: readonly string[] = ['']
  for (let length = 1; length <= maxLength; length++) {
    const next: string[] = []
    for (const prefix of frontier) for (const token of tokens) next.push(prefix + token)
    yield* next
    frontier = next
  }
}

/** Deterministic pseudo-random strings (LCG, high bits), so a failure replays. */
function* fuzz(
  alphabet: readonly string[],
  count: number,
  maxLength: number,
  seed: number,
): Generator<string> {
  let state = seed
  const draw = (limit: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) % limit
  }
  for (let i = 0; i < count; i++) {
    const length = draw(maxLength + 1)
    let text = ''
    for (let j = 0; j < length; j++) text += alphabet[draw(alphabet.length)] ?? ''
    yield text
  }
}

interface Comparison {
  readonly checked: number
  readonly accepted: number
  readonly mismatches: readonly string[]
}

function compare(
  corpus: Iterable<string>,
  actual: (raw: string) => ValidationResult<string>,
  expected: (raw: string) => ValidationResult<string>,
): Comparison {
  const mismatches: string[] = []
  let checked = 0
  let accepted = 0
  for (const raw of corpus) {
    checked++
    const got = JSON.stringify(actual(raw))
    const want = JSON.stringify(expected(raw))
    if (want.startsWith('{"ok":true')) accepted++
    if (got !== want && mismatches.length < 5)
      mismatches.push(`${JSON.stringify(raw)} -> plain ${got}, zod ${want}`)
  }
  return { checked, accepted, mismatches }
}

/** `x` repeated 0..max times, bare and padded with every kind of trimmed whitespace. */
function* paddedRuns(unit: string, max: number): Generator<string> {
  for (let count = 0; count <= max; count++) {
    const run = unit.repeat(count)
    yield run
    yield ` ${run}\t`
    yield '\u00a0\n' + run + '\u2003 '
  }
}

describe('plain validators equal the zod schemas they replaced', () => {
  it('parseEmail: structured and random corpus, messages and normalised values included', () => {
    const tokens = [
      'a', 'B', '7', '_', '-', "'", '+', '.', '@', 'ö', 'K', 'İ', ' ', 'b.co', 'm', '.se',
    ] // prettier-ignore
    const alphabet = [
      'a', 'z', 'A', 'Z', '0', '9', '_', '-', "'", '+', '.', '.', '@', '@', 'ö', 'é', 'K',
      'İ', 'ſ', ' ', '\t', '\n', ' ', 'c', 'o', 'm',
    ] // prettier-ignore
    const lengths = [...paddedRuns('a', 3)].map((local) => `${local}@example.com`)
    const longRuns = [240, 241, 242, 243, 244, 300].flatMap((n) => [
      `${'a'.repeat(n)}@example.com`,
      `${'A'.repeat(n)}@EXAMPLE.COM`,
      ` ${'a'.repeat(n)}@example.com\n`,
      'a'.repeat(n),
    ])
    const result = compare(
      [...sequences(tokens, 4), ...fuzz(alphabet, 40_000, 24, 20_261_024), ...lengths, ...longRuns],
      parseEmail,
      (raw) => oracle(emailSchema, raw),
    )
    expect(result.mismatches).toEqual([])
    expect(result.checked).toBeGreaterThan(100_000)
    expect(result.accepted).toBeGreaterThan(200)
    expect(result.checked - result.accepted).toBeGreaterThan(50_000)
  }, 60_000)

  it('parsePhone: separators, prefixes, digit lengths and non-ASCII digits', () => {
    const tokens = ['0', '7', '4', '6', '+', '-', ' ', '(', ')', 'a', '٣', ' ']
    const alphabet = ['0', '7', '1', '4', '6', '+', '-', ' ', '(', ')']
    const structured = ['', '+46', '0046', '+4600', '46', '0', '00', '+0046'].flatMap((prefix) =>
      ['7', '07'].flatMap((lead) =>
        [6, 7, 8, 9, 10].map(
          (digits) => `${prefix}${lead}${'1234567890'.repeat(2).slice(0, digits)}`,
        ),
      ),
    )
    const separated = ['', '+46', '0046'].flatMap((prefix) =>
      [' ', '-', ''].flatMap((gap) =>
        '0123456789'.split('').map((digit) => `${prefix}${gap}07${digit}${gap}123${gap}45${gap}67`),
      ),
    )
    const result = compare(
      [
        ...sequences(tokens, 4),
        ...fuzz(alphabet, 30_000, 16, 7_654_321),
        ...structured,
        ...separated,
      ],
      parsePhone,
      (raw) => oracle(phoneSchema, raw),
    )
    expect(result.mismatches).toEqual([])
    expect(result.accepted).toBeGreaterThan(30)
    expect(result.checked - result.accepted).toBeGreaterThan(10_000)
  }, 60_000)

  it('parseName: every length from 0 to 90 code units, padded, with emoji and lone surrogates', () => {
    const tokens = ['a', ' ', '\t', '\n', ' ', ' ', '😀', '\ud83d']
    const result = compare(
      [...sequences(tokens, 4), ...paddedRuns('x', 90), ...paddedRuns('😀', 45)],
      parseName,
      (raw) => oracle(nameSchema, raw),
    )
    expect(result.mismatches).toEqual([])
    expect(result.accepted).toBeGreaterThan(100)
    expect(result.checked - result.accepted).toBeGreaterThan(100)
  })

  it('parseReview text: every length from 0 to 610 code units, padded, with emoji', () => {
    const phone = '0701234567'
    const fromReview = (text: string): ValidationResult<string> => {
      const review = parseReview({ phone, rating: 5, text })
      return review.ok
        ? { ok: true, value: review.value.text }
        : { ok: false, error: review.fields.text ? 'text' : 'valid' }
    }
    const expected = (text: string): ValidationResult<string> => {
      const want = oracle(reviewTextSchema, text)
      return want.ok ? want : { ok: false, error: 'text' }
    }
    const result = compare(
      [...paddedRuns('y', 610), ...paddedRuns('😀', 305), ...sequences(['a', ' ', '\n', '😀'], 5)],
      fromReview,
      expected,
    )
    expect(result.mismatches).toEqual([])
    expect(result.accepted).toBeGreaterThan(500)
    expect(result.checked - result.accepted).toBeGreaterThan(50)
  })
})
