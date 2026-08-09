// Boundary validation with Zod + branded types. The booking submit must validate contact
// details before producing a `Booking`. Branded types make a validated value impossible to
// confuse with a raw string.
//
// NOTE (pixel parity): the original mock had NO format validation and NO error UI — its button
// was gated purely on non-empty fields. This module is used *inside the submit seam* only; it
// does not drive any visible disabled/error state, so it cannot move a pixel.

import { z } from 'zod'

// --- Branded types -------------------------------------------------------------------------

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

export type Name = Brand<string, 'Name'>
export type Phone = Brand<string, 'Phone'>
export type Email = Brand<string, 'Email'>

/** Result-shaped output (no exceptions for control flow). */
export type ValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

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

const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().email('Invalid email address').max(254, 'Email is too long'))

// --- Parsers (safeParse -> Result) ---------------------------------------------------------

function toResult<T>(
  parsed: z.SafeParseReturnType<unknown, string>,
  asBrand: (v: string) => T,
): ValidationResult<T> {
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

export function parseEmail(raw: string): ValidationResult<Email> {
  return toResult(emailSchema.safeParse(raw), (v) => v as Email)
}

/**
 * Validated contact details ready to attach to a `Booking`.
 */
export interface ValidContact {
  readonly name: Name
  readonly phone: Phone
  readonly email: Email
}

/**
 * Per-field validity flags — `true` means that field FAILED validation. Drives the per-field red
 * border + localized note in the UI.
 */
export interface FieldErrors {
  readonly name: boolean
  readonly phone: boolean
  readonly email: boolean
}

/** Result of validating the whole contact form. */
export type ContactValidation =
  | { readonly ok: true; readonly value: ValidContact }
  | { readonly ok: false; readonly fields: FieldErrors }

/**
 * Validate required name, phone, and email, reporting every invalid field.
 */
export function parseContact(input: {
  name: string
  phone: string
  email: string
}): ContactValidation {
  const name = parseName(input.name)
  const phone = parsePhone(input.phone)
  const email = parseEmail(input.email)

  const fields: FieldErrors = {
    name: !name.ok,
    phone: !phone.ok,
    email: !email.ok,
  }
  if (!name.ok || !phone.ok || !email.ok) {
    return { ok: false, fields }
  }
  return { ok: true, value: { name: name.value, phone: phone.value, email: email.value } }
}
