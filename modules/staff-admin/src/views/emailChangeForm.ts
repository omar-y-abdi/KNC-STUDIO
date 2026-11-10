// Pure decisions of the Settings email form: what a submit may send, and what the form holds and
// shows after the function answered. No effects: the view owns the state and makes the call.

import type { AdminStrings } from '../adminStrings'
import type { EmailChangeOutcome } from '../auth'

export type EmailFormStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string }
  // An error that belongs to the current-password field.
  | { readonly kind: 'password_error'; readonly message: string }
  | { readonly kind: 'done' }

export interface EmailFormFields {
  readonly newEmail: string
  readonly password: string
}

export type EmailFormText = Pick<
  AdminStrings,
  | 'settingsEmailInvalid'
  | 'settingsEmailSame'
  | 'settingsEmailPasswordRequired'
  | 'settingsEmailPasswordWrong'
  | 'settingsEmailRateLimited'
>

/** The id of the element that shows the form's error; the password field points at it. */
export const EMAIL_ERROR_ID = 'settings-email-error'

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * Check the typed values before anything is sent: the address first, then the password. The address
 * goes out trimmed and lower-cased, the password as typed.
 */
export function checkEmailChange(
  fields: EmailFormFields,
  currentEmail: string,
  t: EmailFormText,
):
  | { readonly ok: true; readonly email: string; readonly password: string }
  | { readonly ok: false; readonly status: EmailFormStatus } {
  const email = fields.newEmail.trim().toLowerCase()
  if (!validEmail(email)) {
    return { ok: false, status: { kind: 'error', message: t.settingsEmailInvalid } }
  }
  if (email === currentEmail.toLowerCase()) {
    return { ok: false, status: { kind: 'error', message: t.settingsEmailSame } }
  }
  if (fields.password === '') {
    return {
      ok: false,
      status: { kind: 'password_error', message: t.settingsEmailPasswordRequired },
    }
  }
  return { ok: true, email, password: fields.password }
}

/**
 * What the form holds and shows after the function answered. Only a sent link empties the fields: a
 * failure keeps the address and the password. Only a refused password marks the password field.
 */
export function afterEmailChange(
  outcome: EmailChangeOutcome,
  fields: EmailFormFields,
  t: EmailFormText,
): { readonly fields: EmailFormFields; readonly status: EmailFormStatus } {
  switch (outcome.kind) {
    case 'sent':
      return { fields: { newEmail: '', password: '' }, status: { kind: 'done' } }
    case 'wrong_password':
      return { fields, status: { kind: 'password_error', message: t.settingsEmailPasswordWrong } }
    case 'rate_limited':
      return { fields, status: { kind: 'error', message: t.settingsEmailRateLimited } }
    case 'error':
      return { fields, status: { kind: 'error', message: outcome.error.message } }
  }
}

/** The ARIA state of the current-password input: invalid and described by the error only for its own. */
export function passwordFieldAria(status: EmailFormStatus): {
  readonly 'aria-invalid': boolean
  readonly 'aria-describedby': string | undefined
} {
  const invalid = status.kind === 'password_error'
  return { 'aria-invalid': invalid, 'aria-describedby': invalid ? EMAIL_ERROR_ID : undefined }
}
