import { describe, expect, it } from 'vitest'
import { EMAIL_NAMES, emptyDocument, defaultEmailDesign } from '../../shared/cms'
import {
  buildEmailMessage as deliveredEmail,
  defaultEmailTemplate,
} from '../../supabase/functions/_shared/email'
import { buildEmailMessage } from '../../shared/email-render'
import { emailPreviewInput, renderEmailPreview } from '../../src/admin/cms/emailPreview'

describe('CMS email preview uses transactional delivery', () => {
  it('has one renderer for preview and outgoing mail', () => {
    expect(deliveredEmail).toBe(buildEmailMessage)
  })
  it.each(
    EMAIL_NAMES.flatMap((template) => (['sv', 'en'] as const).map((lang) => ({ template, lang }))),
  )(
    'renders the actual $template / $lang message with expanded sample values',
    ({ template, lang }) => {
      const document = emptyDocument()
      document.settings.business_name = 'Owner & Studio'
      document.settings.business_street = 'Owner Street 7'
      const copy = defaultEmailTemplate(template, lang)
      const email = {
        template,
        lang,
        subject: copy.subject,
        preheader: copy.preheader,
        title: copy.title,
        intro: copy.intro,
        section_title: copy.sectionTitle,
        note: copy.note,
        cta_label: copy.ctaLabel,
        contact_lead: copy.contactLead,
        design: null,
      }
      const actual = renderEmailPreview(document, email)
      expect(actual).toEqual(deliveredEmail(emailPreviewInput(document, email)))
      expect(actual.html).toContain('bgcolor="#151517"')
      expect(actual.html).toContain('Owner Street 7')
      expect(actual.html).not.toMatch(
        /\{(?:customer_name|barber_name|business_name|new_email|booking_date|booking_time|cancellation_hours)\}/,
      )
      expect(actual.html.includes('350')).toBe(
        /_(confirmation|cancellation|reminder)$/.test(template),
      )
      const designed = renderEmailPreview(document, { ...email, design: defaultEmailDesign() })
      expect(designed.html).toContain('data-email-part="title"')
      expect(designed.html).toContain('Owner &amp; Studio')
    },
  )
  it('keeps draft line breaks and escapes markup in the real email', () => {
    const document = emptyDocument()
    const email = {
      template: 'auth_recovery' as const,
      lang: 'sv' as const,
      subject: 'Preview',
      preheader: '',
      title: 'Title',
      intro: 'First\n<strong>literal</strong>',
      section_title: null,
      note: '',
      cta_label: 'Open',
      contact_lead: null,
      design: null,
    }
    expect(renderEmailPreview(document, email).html).toContain(
      'First<br>&lt;strong&gt;literal&lt;/strong&gt;',
    )
  })
})
