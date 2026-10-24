import { z } from 'zod'

const required = (name: string) =>
  z.string({ message: `${name} is required` }).min(1, `${name} is required`)

const bookingSchema = z
  .object(
    {
      barberId: required('barberId'),
      serviceId: required('serviceId'),
      startAt: required('startAt'),
      phone: required('phone'),
      email: z
        .string({ message: 'email is invalid' })
        .trim()
        .toLowerCase()
        .min(1, 'email is invalid')
        .max(254, 'email is invalid')
        .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'email is invalid'),
      lang: z.enum(['sv', 'en'], { message: 'lang is invalid' }),
      customerName: required('customerName'),
    },
    { message: 'booking is required' },
  )
  .strict()

/** The Turnstile token is empty when the widget is offline, so a missing or non-text token counts as empty. */
export const requestSchema = z
  .object(
    {
      booking: bookingSchema,
      turnstileToken: z.string().catch(''),
      rememberBookings: z.boolean().catch(false),
    },
    { message: 'body must be a JSON object' },
  )
  .strict()
