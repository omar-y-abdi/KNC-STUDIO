// Builds each outgoing email together with the copy the owner's delivery log keeps.
import {
  buildEmailMessage,
  type EmailBuildInput,
  type EmailMessage,
} from '../../../shared/email-render.ts'
import {
  HIDDEN_LINK,
  type EmailSendKind,
  type EmailSendOutcome,
} from '../../../shared/email-send-log.ts'

/**
 * Whether a kind's call-to-action link is a bearer credential: an Auth token_hash, the permanent
 * Mina bokningar token or the customer email-link proof. Every new kind must be classified here.
 */
export const EMAIL_LINK_EXPOSURE: Readonly<Record<EmailSendKind, 'secret' | 'plain'>> = {
  customer_confirmation: 'secret',
  customer_reminder: 'secret',
  customer_booking_access: 'secret',
  customer_email_link: 'secret',
  auth_recovery: 'secret',
  auth_email_change: 'secret',
  auth_invite: 'secret',
  customer_cancellation: 'plain',
  barber_confirmation: 'plain',
  barber_cancellation: 'plain',
}

export interface StoredEmailCopy {
  readonly subject: string
  readonly html: string
  readonly text: string
}

/** A message ready for Resend and the record of it the delivery log may keep. */
export interface PreparedEmail {
  readonly kind: EmailSendKind
  readonly bookingId: string | null
  readonly message: EmailMessage
  readonly stored: StoredEmailCopy
}

/** The service-role client capability the delivery log needs. */
export interface EmailSendLogClient {
  rpc(
    name: string,
    params: Readonly<Record<string, unknown>>,
  ): PromiseLike<{ readonly error: { readonly code?: string } | null }>
}

function storedCopy(message: EmailMessage): StoredEmailCopy {
  return { subject: message.subject, html: message.html, text: message.text }
}

/**
 * The renderer writes `ctaHref` only into the call-to-action (the HTML href and the text part's
 * link line). Rendering the stored copy with the placeholder therefore leaves the credential out
 * in every encoding, and everything else is byte-identical to the sent message. The log row may
 * still shorten an over-long subject (see storedSubject).
 */
export function prepareEmail(
  kind: EmailSendKind,
  input: EmailBuildInput,
  bookingId: string | null,
): PreparedEmail {
  const message = buildEmailMessage(input)
  const stored =
    EMAIL_LINK_EXPOSURE[kind] === 'secret'
      ? buildEmailMessage({ ...input, ctaHref: HIDDEN_LINK })
      : message
  return { kind, bookingId, message, stored: storedCopy(stored) }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The delivery log's subject CHECK, in code points as PostgreSQL's char_length counts them. */
const STORED_SUBJECT_MAX = 998

/**
 * A subject the log accepts. Placeholders such as {new_email} can render a published subject past
 * the bound; the log then keeps its first 997 characters and an ellipsis, cut between code points so
 * no character is split. The message itself is sent with the full subject.
 */
function storedSubject(subject: string): string {
  const characters = Array.from(subject)
  return characters.length <= STORED_SUBJECT_MAX
    ? subject
    : `${characters.slice(0, STORED_SUBJECT_MAX - 1).join('')}…`
}

/**
 * Arguments of `internal_record_email_send`. Auth idempotency keys embed a token_hash prefix, so
 * only the key's SHA-256 is stored; it still groups retries of one message into one row.
 */
export async function emailSendRecordParams(
  email: PreparedEmail,
  idempotencyKey: string,
  outcome: EmailSendOutcome,
): Promise<Readonly<Record<string, unknown>>> {
  return {
    p_dedupe_key: await sha256Hex(idempotencyKey),
    p_kind: email.kind,
    p_recipient: email.message.to,
    p_subject: storedSubject(email.stored.subject),
    p_html: email.stored.html,
    p_text_body: email.stored.text,
    p_status: outcome.status,
    p_error_code: outcome.status === 'failed' ? outcome.errorCode : null,
    p_booking_id: email.bookingId,
  }
}
