import { z } from 'zod'

/** A non-text address reads as empty so the handler answers `invalid_email`; any language but `en` is Swedish. */
export const requestSchema = z
  .object({
    new_email: z
      .string()
      .catch('')
      .transform((value) => value.trim().toLowerCase()),
    lang: z.enum(['sv', 'en']).catch('sv'),
  })
  .strict()
