import { z } from 'zod'
import { uuid } from '../_shared/http.ts'

/** The flat shape the handler works with; each action fills only the fields it carries. */
export interface ParsedAction {
  readonly action:
    | 'request_access'
    | 'exchange_access'
    | 'list'
    | 'cancel'
    | 'review'
    | 'forget_device'
    | 'request_link'
    | 'confirm_link'
  readonly phone?: string
  readonly email?: string
  readonly bookingId?: string
  readonly accessToken?: string
  readonly rating?: number
  readonly text?: string
  readonly turnstileToken?: string
  readonly lang?: 'sv' | 'en'
  readonly linkCode?: string
  readonly sourceEmail?: string
}

/** Trimmed and lowercase, as the database stores it. */
export const emailAddress = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .max(254)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  )

const swedishMobile = z
  .string()
  .transform((value) => value.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^07[0-9]{8}$/))
const opaqueToken = z.string().regex(/^[0-9a-f]{64}$/i)
const lang = z.enum(['sv', 'en'])

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('forget_device') }).strict(),
  z
    .object({
      action: z.literal('request_link'),
      email: emailAddress,
      sourceEmail: emailAddress,
      lang,
    })
    .strict(),
  z.object({ action: z.literal('confirm_link'), linkCode: opaqueToken }).strict(),
  z.object({ action: z.literal('exchange_access'), accessCode: opaqueToken }).strict(),
  z.object({ action: z.literal('list'), accessToken: opaqueToken.optional() }).strict(),
  z
    .object({
      action: z.literal('cancel'),
      bookingId: uuid,
      accessToken: opaqueToken.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('request_access'),
      email: emailAddress,
      lang,
      turnstileToken: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal('review'),
      phone: swedishMobile,
      accessToken: opaqueToken.optional(),
      rating: z.number().int().min(1).max(5),
      text: z.string().min(1).max(1000),
      turnstileToken: z.string(),
    })
    .strict(),
])

type Body = z.output<typeof bodySchema>

function withToken(accessToken: string | undefined): { readonly accessToken?: string } {
  return accessToken === undefined ? {} : { accessToken }
}

function flatten(body: Body): ParsedAction {
  switch (body.action) {
    case 'forget_device':
      return { action: body.action }
    case 'request_link':
      return {
        action: body.action,
        email: body.email,
        sourceEmail: body.sourceEmail,
        lang: body.lang,
      }
    case 'confirm_link':
      return { action: body.action, linkCode: body.linkCode.toLowerCase() }
    case 'exchange_access':
      return { action: body.action, accessToken: body.accessCode }
    case 'list':
      return { action: body.action, ...withToken(body.accessToken) }
    case 'cancel':
      return { action: body.action, ...withToken(body.accessToken), bookingId: body.bookingId }
    case 'request_access':
      return {
        action: body.action,
        email: body.email,
        lang: body.lang,
        turnstileToken: body.turnstileToken,
      }
    case 'review':
      return {
        action: body.action,
        phone: body.phone,
        ...withToken(body.accessToken),
        rating: body.rating,
        text: body.text,
        turnstileToken: body.turnstileToken,
      }
  }
}

export const requestSchema = bodySchema.transform(flatten)
