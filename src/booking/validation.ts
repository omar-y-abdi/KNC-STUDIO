// Boundary validation with Zod + branded types. The booking submit must validate contact
// details before producing a `Booking`. Branded types make a validated value impossible to
// confuse with a raw string.
//
// NOTE (pixel parity): the source has NO format validation and NO error UI — its button is
// gated purely on non-empty fields. This module is used *inside the submit seam* only; it does
// not drive any visible disabled/error state, so it cannot move a pixel.

import { z } from 'zod'

// --- Branded types -------------------------------------------------------------------------

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

export type Name = Brand<string, 'Name'>
export type Phone = Brand<string, 'Phone'>

/** Result-shaped output (no exceptions for control flow). */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

// --- Schemas -------------------------------------------------------------------------------

const MAX_NAME = 80

const nameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'Name is required').max(MAX_NAME, 'Name is too long'))

// Swedish mobile: accept `07XXXXXXXX` with spaces/dashes tolerated; an optional `+46`/`0046`
// country prefix is normalised to a leading `0`. Validation runs on the digit-normalised form
// with a NON-backtracking anchored regex (`security/detect-unsafe-regex` safe).
const SWEDISH_MOBILE = /^07\d{8}$/

/** Strip spaces, dashes and parentheses; map `+46`/`0046` country prefix to a leading `0`. */
export function normalizePhone(raw: string): string {
  const compact = raw.replace(/[\s\-()]/g, '')
  const national = compact.replace(/^(?:\+46|0046)/, '0')
  return national
}

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(SWEDISH_MOBILE, 'Invalid Swedish mobile number'))

// --- Parsers (safeParse -> Result) ---------------------------------------------------------

function toResult<T>(parsed: z.SafeParseReturnType<unknown, string>, asBrand: (v: string) => T): ValidationResult<T> {
  if (parsed.success) return { ok: true, value: asBrand(parsed.data) }
  const first = parsed.error.issues[0]
  return { ok: false, error: first ? first.message : 'Invalid value' }
}

export function parseName(raw: string): ValidationResult<Name> {
  return toResult(nameSchema.safeParse(raw), (v) => v as Name)
}

export function parsePhone(raw: string): ValidationResult<Phone> {
  return toResult(phoneSchema.safeParse(raw), (v) => v as Phone)
}

/**
 * Validated contact details ready to attach to a `Booking`. Email was removed — the only channel is
 * SMS, so a validated phone is always present.
 */
export interface ValidContact {
  readonly name: Name
  readonly phone: Phone
}

/**
 * Per-field validity flags — `true` means that field FAILED validation. Drives the per-field red
 * border + localized note in the UI.
 */
export interface FieldErrors {
  readonly name: boolean
  readonly phone: boolean
}

/** Result of validating the whole contact form. */
export type ContactValidation =
  | { readonly ok: true; readonly value: ValidContact }
  | { readonly ok: false; readonly fields: FieldErrors }

/**
 * Validate the contact form (name + phone, both always required now that SMS is the only channel),
 * reporting which field(s) failed. On success, returns the branded `ValidContact`.
 */
export function parseContact(input: { name: string; phone: string }): ContactValidation {
  const name = parseName(input.name)
  const phone = parsePhone(input.phone)

  const fields: FieldErrors = {
    name: !name.ok,
    phone: !phone.ok,
  }
  if (!name.ok || !phone.ok) {
    return { ok: false, fields }
  }
  return { ok: true, value: { name: name.value, phone: phone.value } }
}
