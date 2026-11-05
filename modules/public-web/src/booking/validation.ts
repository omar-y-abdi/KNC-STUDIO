// Boundary validation with plain functions + branded types. The booking submit must validate contact
// details before producing a `Booking`. Branded types make a validated value impossible to
// confuse with a raw string.
//
// NOTE (pixel parity): the original mock had NO format validation and NO error UI — its button
// was gated purely on non-empty fields. This module is used *inside the submit seam* only; it
// does not drive any visible disabled/error state, so it cannot move a pixel.

// --- Branded types -------------------------------------------------------------------------

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

export type Name = Brand<string, 'Name'>
export type Phone = Brand<string, 'Phone'>
export type Email = Brand<string, 'Email'>

/** Result-shaped output (no exceptions for control flow). */
export type ValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

const valid = <T>(value: T): ValidationResult<T> => ({ ok: true, value })
const invalid = (error: string): ValidationResult<never> => ({ ok: false, error })

// --- Rules ---------------------------------------------------------------------------------

const MAX_NAME = 80
const MAX_EMAIL = 254

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

// Email shape, on the trimmed + lower-cased input: exactly one `@`; a local part of letters, digits
// and `_ ' + . -` that does not start with a dot, does not end with a dot or quote and holds no
// `..`; a domain of dot-separated labels (letter or digit first, then letters, digits or `-`)
// ending in a label of two or more letters. Checked part by part, because one regex for the whole
// address needs a nested quantifier (`security/detect-unsafe-regex`).
const EMAIL_LOCAL_CHARS = /^[a-z0-9_'+.-]+$/
const EMAIL_LOCAL_END = /[a-z0-9_+-]$/
const EMAIL_LABEL = /^[a-z0-9][a-z0-9-]*$/
const EMAIL_TLD = /^[a-z]{2,}$/

function isEmailLocalPart(local: string): boolean {
  return (
    EMAIL_LOCAL_CHARS.test(local) &&
    EMAIL_LOCAL_END.test(local) &&
    !local.startsWith('.') &&
    !local.includes('..')
  )
}

function isEmailDomain(domain: string): boolean {
  const labels = domain.split('.')
  const tld = labels.pop()
  return (
    tld !== undefined &&
    EMAIL_TLD.test(tld) &&
    labels.length > 0 &&
    labels.every((label) => EMAIL_LABEL.test(label))
  )
}

function isEmailAddress(email: string): boolean {
  const parts = email.split('@')
  const [local, domain] = parts
  if (parts.length !== 2 || local === undefined || domain === undefined) return false
  return isEmailLocalPart(local) && isEmailDomain(domain)
}

// --- Parsers (plain functions -> Result) ---------------------------------------------------

export function parseName(raw: string): ValidationResult<Name> {
  const name = raw.trim()
  if (name.length < 1) return invalid('Name is required')
  if (name.length > MAX_NAME) return invalid('Name is too long')
  return valid(name as Name)
}

export function parsePhone(raw: string): ValidationResult<Phone> {
  const phone = normalizePhone(raw)
  if (!SWEDISH_MOBILE.test(phone)) return invalid('Invalid Swedish mobile number')
  return valid(phone as Phone)
}

export function parseEmail(raw: string): ValidationResult<Email> {
  const email = raw.trim().toLowerCase()
  if (!isEmailAddress(email)) return invalid('Invalid email address')
  if (email.length > MAX_EMAIL) return invalid('Email is too long')
  return valid(email as Email)
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
