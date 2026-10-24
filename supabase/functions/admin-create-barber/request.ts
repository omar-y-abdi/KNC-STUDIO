import { z } from 'zod'

const required = (name: string) =>
  z.string({ message: `${name} is required` }).min(1, `${name} is required`)

/** The address is shape-checked as sent, then stored trimmed and lowercase. Any language but `en` is Swedish. */
export const requestSchema = z
  .object(
    {
      email: required('email')
        .refine(
          (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254,
          'email is invalid',
        )
        .transform((value) => value.trim().toLowerCase()),
      barber_id: required('barber_id'),
      lang: z.enum(['sv', 'en']).catch('sv'),
    },
    { message: 'body must be a JSON object' },
  )
  .strict()
