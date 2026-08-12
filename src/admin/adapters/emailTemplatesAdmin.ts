import type { Lang } from '../../i18n/index'
import { getAdminClient } from '../adminClient'
import { emailTemplateRows, parseWith } from '../adminSchemas'
import type { AdminResult } from '../types'
import { err, ok } from '../types'

export type EmailTemplateName =
  | 'customer_confirmation'
  | 'barber_confirmation'
  | 'customer_cancellation'
  | 'barber_cancellation'
  | 'customer_reminder'
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
