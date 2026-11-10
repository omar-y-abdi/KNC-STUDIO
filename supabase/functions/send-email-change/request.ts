import { z } from 'zod'

/**
 * A non-text address reads as empty so the handler answers `invalid_email`; any language but `en` is Swedish.
 * The password bound (72 UTF-16 units) never rejects a stored one: Auth stores at most 72 bytes, and
 * a text has at least as many UTF-8 bytes as UTF-16 units.
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
