// Vocabulary of the owner's email delivery log (public.email_send_log). The table's CHECK
// constraints list exactly these values; the Edge senders write them and the Studio reads them.
import type { EmailTemplateName } from './email-render.ts'

/** One kind per transactional email: every template plus the customer email-link proof. */
export type EmailSendKind = EmailTemplateName | 'customer_email_link'

export const EMAIL_SEND_KINDS = [
  'customer_confirmation',
  'barber_confirmation',
  'customer_cancellation',
  'barber_cancellation',
  'customer_reminder',
  'customer_booking_access',
  'customer_email_link',
  'auth_recovery',
  'auth_email_change',
  'auth_invite',
] as const satisfies readonly EmailSendKind[]

export const EMAIL_SEND_FAILURE_CODES = ['send_failed_transient', 'send_failed_permanent'] as const

export type EmailSendFailureCode = (typeof EMAIL_SEND_FAILURE_CODES)[number]

/** The provider's answer to one send attempt. */
export type EmailSendOutcome =
  | { readonly status: 'sent' }
  | { readonly status: 'failed'; readonly errorCode: EmailSendFailureCode }

/** Visible text of the link that replaces a credential in the stored copy. */
export const HIDDEN_LINK = '[dold länk]'
