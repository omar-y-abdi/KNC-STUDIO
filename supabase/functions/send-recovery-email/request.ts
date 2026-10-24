import { z } from 'zod'

/** Unreadable fields read as empty or Swedish: the handler stays quiet about unusable addresses. */
export const requestSchema = z
  .object({
    email: z
      .string()
      .catch('')
      .transform((value) => value.trim().toLowerCase()),
    lang: z.enum(['sv', 'en']).catch('sv'),
    turnstileToken: z.string().catch(''),
  })
  .strict()
