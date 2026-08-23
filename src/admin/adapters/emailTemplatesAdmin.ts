import type { Lang } from '../../i18n/index'
import { getAdminClient } from '../adminClient'
import {
  emailTemplateRows,
  failedBookingEmailDeliveryRows,
  discardFailedBookingEmailDeliveryResponse,
  parseWith,
  retryFailedBookingEmailDeliveryResponse,
} from '../adminSchemas'
import type { AdminResult } from '../types'
import { err, ok } from '../types'

export type EmailTemplateName =
  | 'customer_confirmation'
  | 'barber_confirmation'
  | 'customer_cancellation'
  | 'barber_cancellation'
  | 'customer_reminder'
  | 'customer_booking_access'
  | 'auth_recovery'
  | 'auth_email_change'
  | 'auth_invite'

export interface EditableEmailTemplate {
  readonly template: EmailTemplateName
  readonly lang: Lang
  readonly subject: string
  readonly preheader: string
  readonly title: string
  readonly intro: string
  readonly sectionTitle: string | null
  readonly note: string
  readonly ctaLabel: string
  readonly contactLead: string | null
}

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
}

const READ_ERROR = 'Kunde inte läsa mejlmallarna.'
const WRITE_ERROR = 'Kunde inte spara mejlmallen. Försök igen.'

export async function listEmailTemplates(): Promise<AdminResult<readonly EditableEmailTemplate[]>> {
  try {
    const { data, error } = await getAdminClient()
      .from('email_templates')
      .select(
        'template,lang,subject,preheader,title,intro,section_title,note,cta_label,contact_lead',
      )
    if (error !== null || data === null) return err('network', READ_ERROR)
    const parsed = parseWith(emailTemplateRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(
      parsed.value.map((row) => ({
        template: row.template,
        lang: row.lang,
        subject: row.subject,
        preheader: row.preheader,
        title: row.title,
        intro: row.intro,
        sectionTitle: row.section_title,
        note: row.note,
        ctaLabel: row.cta_label,
        contactLead: row.contact_lead,
      })),
    )
  } catch {
    return err('network', READ_ERROR)
  }
}

export async function saveEmailTemplate(
  template: EditableEmailTemplate,
): Promise<AdminResult<EditableEmailTemplate>> {
  try {
    const { data, error } = await getAdminClient()
      .from('email_templates')
      .upsert(
        {
          template: template.template,
          lang: template.lang,
          subject: template.subject,
          preheader: template.preheader,
          title: template.title,
          intro: template.intro,
          section_title: template.sectionTitle,
          note: template.note,
          cta_label: template.ctaLabel,
          contact_lead: template.contactLead,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'template,lang' },
      )
      .select(
        'template,lang,subject,preheader,title,intro,section_title,note,cta_label,contact_lead',
      )
      .single()
    if (error !== null || data === null) {
      if (error?.code === '42501') return err('forbidden', 'Endast ägaren kan ändra mejlmallar.')
      if (error?.code === '23514')
        return err('validation', 'Kontrollera att alla texter har giltig längd.')
      return err('network', WRITE_ERROR)
    }
    const parsed = parseWith(emailTemplateRows, [data])
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    const row = parsed.value[0]
    if (row === undefined) return err('malformed', WRITE_ERROR)
    return ok({
      template: row.template,
      lang: row.lang,
      subject: row.subject,
      preheader: row.preheader,
      title: row.title,
      intro: row.intro,
      sectionTitle: row.section_title,
      note: row.note,
      ctaLabel: row.cta_label,
      contactLead: row.contact_lead,
    })
  } catch {
    return err('network', WRITE_ERROR)
  }
}

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
