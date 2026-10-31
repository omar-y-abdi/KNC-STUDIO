import type { EmailSendKind, EmailSendOutcome } from '../../../shared/email-send-log'
import { getAdminClient } from '../adminClient'
import {
  emailSendLogCopy,
  emailSendLogPage,
  failedBookingEmailDeliveryRows,
  discardFailedBookingEmailDeliveryResponse,
  parseWith,
  retryFailedBookingEmailDeliveryResponse,
} from '../adminSchemas'
import type { AdminResult } from '../types'
import { err, ok } from '../types'

export interface FailedBookingEmailDelivery {
  readonly id: string
  readonly bookingId: string
  readonly event: 'booking_confirmed' | 'booking_cancelled'
  readonly attemptCount: number
  readonly errorCode:
    | 'not_configured'
    | 'send_failed'
    | 'send_failed_transient'
    | 'send_failed_permanent'
    | 'message_build_failed'
    | null
  readonly failedAt: string | null
  /** Recipients the job already reached; the others are still owed this email. */
  readonly sentKinds: readonly ('customer' | 'barber')[]
  readonly customerName: string
  readonly customerEmail: string | null
  readonly customerPhone: string | null
  readonly bookingStartAt: string
  readonly barberName: string
  readonly barberEmail: string | null
}

export interface EmailSendLogEntry {
  readonly id: string
  /** The database timestamp verbatim: it is also the paging cursor, so never round it. */
  readonly createdAt: string
  readonly kind: EmailSendKind
  readonly recipient: string
  readonly subject: string
  readonly outcome: EmailSendOutcome
  readonly attemptCount: number
}

/** Where the next page starts: just after this entry in newest-first order. */
export interface EmailSendLogCursor {
  readonly before: string
  readonly beforeId: string
}

export interface EmailSendLogPage {
  readonly entries: readonly EmailSendLogEntry[]
  readonly next: EmailSendLogCursor | null
}

/** The stored copy of one sent email, credential links already replaced. */
export interface EmailSendLogCopy {
  readonly subject: string
  readonly html: string
  readonly text: string
}

const READ_ERROR = 'Kunde inte läsa misslyckade mejlleveranser.'
const WRITE_ERROR = 'Kunde inte uppdatera mejlleveransen. Försök igen.'
const LOG_ERROR = 'Kunde inte läsa leveransstatus för mejl.'
const COPY_ERROR = 'Kunde inte öppna mejlet.'
const PAGE_SIZE = 50

export async function listFailedBookingEmailDeliveries(): Promise<
  AdminResult<readonly FailedBookingEmailDelivery[]>
> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_list_failed_booking_email_deliveries')
    if (error !== null || data === null) return err('network', READ_ERROR)
    const parsed = parseWith(failedBookingEmailDeliveryRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(
      parsed.value.map((row) => ({
        id: row.id,
        bookingId: row.booking_id,
        event: row.event,
        attemptCount: row.attempt_count,
        errorCode: row.last_error_code,
        failedAt: row.failed_at,
        sentKinds: row.sent_kinds,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        customerPhone: row.customer_phone,
        bookingStartAt: row.booking_start_at,
        barberName: row.barber_name,
        barberEmail: row.barber_email,
      })),
    )
  } catch {
    return err('network', READ_ERROR)
  }
}

export async function retryFailedBookingEmailDelivery(id: string): Promise<AdminResult<boolean>> {
  try {
    const { data, error } = await getAdminClient().rpc(
      'admin_retry_failed_booking_email_delivery',
      {
        p_id: id,
      },
    )
    if (error !== null || data === null) return err('network', WRITE_ERROR)
    const parsed = parseWith(retryFailedBookingEmailDeliveryResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return parsed.value.ok
      ? ok(true)
      : err('not_found', 'Mejlet finns inte längre bland misslyckade leveranser.')
  } catch {
    return err('network', WRITE_ERROR)
  }
}

export async function discardFailedBookingEmailDelivery(id: string): Promise<AdminResult<boolean>> {
  try {
    const { data, error } = await getAdminClient().rpc(
      'admin_discard_failed_booking_email_delivery',
      { p_id: id },
    )
    if (error !== null || data === null) return err('network', WRITE_ERROR)
    const parsed = parseWith(discardFailedBookingEmailDeliveryResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return parsed.value.ok
      ? ok(true)
      : err('not_found', 'Mejlet finns inte längre bland misslyckade leveranser.')
  } catch {
    return err('network', WRITE_ERROR)
  }
}

export async function listEmailSendLog(
  cursor: EmailSendLogCursor | null,
): Promise<AdminResult<EmailSendLogPage>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_list_email_send_log', {
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: PAGE_SIZE,
    })
    if (error !== null || data === null) return err('network', LOG_ERROR)
    const parsed = parseWith(emailSendLogPage, data)
    if (!parsed.ok) return err('malformed', LOG_ERROR)
    const entries = parsed.value.entries.map((row): EmailSendLogEntry => ({
      id: row.id,
      createdAt: row.created_at,
      kind: row.kind,
      recipient: row.recipient,
      subject: row.subject,
      outcome:
        row.error_code === null
          ? { status: 'sent' }
          : { status: 'failed', errorCode: row.error_code },
      attemptCount: row.attempt_count,
    }))
    const last = entries.at(-1)
    return ok({
      entries,
      next:
        parsed.value.has_more && last !== undefined
          ? { before: last.createdAt, beforeId: last.id }
          : null,
    })
  } catch {
    return err('network', LOG_ERROR)
  }
}

export async function getEmailSendLogCopy(id: string): Promise<AdminResult<EmailSendLogCopy>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_get_email_send_log_entry', {
      p_id: id,
    })
    if (error !== null) return err('network', COPY_ERROR)
    const parsed = parseWith(emailSendLogCopy, data)
    if (!parsed.ok) return err('malformed', COPY_ERROR)
    if (parsed.value === null) return err('not_found', 'Kopian har rensats (äldre än 30 dagar).')
    return ok({
      subject: parsed.value.subject,
      html: parsed.value.html,
      text: parsed.value.text_body,
    })
  } catch {
    return err('network', COPY_ERROR)
  }
}
