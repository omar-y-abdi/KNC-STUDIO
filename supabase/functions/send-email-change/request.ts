import { z } from 'zod'

/**
 * A non-text address reads as empty so the handler answers `invalid_email`; any language but `en` is Swedish.
 * The current password is required and passed on as typed. Its bound is 72 UTF-16 code units, the
 * length this schema counts. The Auth server stores no password longer than 72 bytes, and a text has
 * at least as many UTF-8 bytes as UTF-16 code units, so the bound never rejects a stored password.
 */
export const requestSchema = z
  .object({
    new_email: z
      .string()
      .catch('')
      .transform((value) => value.trim().toLowerCase()),
    current_password: z.string().min(1).max(72),
    lang: z.enum(['sv', 'en']).catch('sv'),
  })
  .strict()
