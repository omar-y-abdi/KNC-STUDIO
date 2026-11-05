import { describe, expect, it } from 'vitest'
import {
  emptyDocument,
  validateCompleteDocument,
  validateDocument,
  type CmsDocument,
  type CmsEmail,
} from '../../packages/content-contracts/src/cms'

// The retired mail editor wrote email_templates directly and accepted any text within the column
// limits, including a placeholder the renderer does not know. After the authority migration Studio
// publication is the owner's only writer, so that persisted value must neither block an unrelated
// publication nor its own repair. Newly introduced unknown placeholders stay rejected, and every
// supported variable the template already uses must remain.
function recovery(lang: 'sv' | 'en', subject: string): CmsEmail {
  return {
    template: 'auth_recovery',
    lang,
    subject,
    preheader: 'Återställ lösenordet hos {business_name}',
    title: 'Återställ lösenord',
    intro: 'Välj ett nytt lösenord med knappen nedan.',
    section_title: null,
    note: 'Ignorera mejlet om du inte bad om det.',
    cta_label: 'Välj nytt lösenord',
    contact_lead: null,
    design: null,
  }
}

function confirmation(): CmsEmail {
  return {
    template: 'customer_confirmation',
    lang: 'sv',
    subject: 'Bokning hos {business_name}',
    preheader: 'Hej {customer_name}',
    title: 'Bokat hos {barber_name}',
    intro: 'Hej {customer_name}',
    section_title: 'Din tid',
    note: 'Avboka senast {cancellation_hours}h före.',
    cta_label: 'Öppna',
    contact_lead: null,
    design: null,
  }
}

/** The authoritative document as internal_cms_state returns it for the persisted legacy row. */
function persisted(): CmsDocument {
  const document = emptyDocument()
  document.emails.push(recovery('sv', 'Hej {first_name}'), confirmation())
  return document
}

function draft(change: (email: CmsEmail[]) => void): CmsDocument {
  const document = persisted()
  change(document.emails)
  return document
}

function recoverySv(emails: CmsEmail[]): CmsEmail {
  const email = emails.find((item) => item.template === 'auth_recovery' && item.lang === 'sv')
  if (!email) throw new Error('auth_recovery sv fixture missing')
  return email
}

describe('CMS publication of email copy persisted by the retired mail editor', () => {
  it('loads the persisted copy as a valid Studio document', () => {
    // Studio validates the loaded document locally before page creation and layout capture.
    expect(() => validateDocument(persisted())).not.toThrow()
  })

  it('publishes an unrelated business edit while the persisted placeholder stays unchanged', () => {
    const unrelated = persisted()
    unrelated.settings['business_name'] = 'Blade & Blend Studio'
    expect(() => validateCompleteDocument(unrelated, persisted())).not.toThrow()
  })

  it('accepts the owner repair that removes the unsupported placeholder', () => {
    const repaired = draft((emails) => {
      recoverySv(emails).subject = 'Hej'
    })
    expect(() => validateCompleteDocument(repaired, persisted())).not.toThrow()
  })

  it('still requires the supported placeholder the template already uses', () => {
    const dropped = draft((emails) => {
      recoverySv(emails).preheader = 'Återställ lösenordet'
    })
    expect(() => validateCompleteDocument(dropped, persisted())).toThrow(
      'emails.auth_recovery.sv.preheader: Platshållaren {business_name} måste finnas kvar.',
    )
  })

  it('rejects the persisted placeholder copied into a field that did not have it', () => {
    const copied = draft((emails) => {
      recoverySv(emails).title = 'Hej {first_name}'
    })
    expect(() => validateCompleteDocument(copied, persisted())).toThrow(
      'emails.auth_recovery.sv.title: Okänd platshållare {first_name}.',
    )
  })

  it('rejects the persisted placeholder in a language variant that never had it', () => {
    const translated = draft((emails) => {
      emails.push(recovery('en', 'Hello {first_name}'))
    })
    expect(() => validateCompleteDocument(translated, persisted())).toThrow(
      'emails.auth_recovery.en.subject: Okänd platshållare {first_name}.',
    )
  })

  it('rejects a new unknown placeholder in another template', () => {
    const introduced = draft((emails) => {
      const email = emails.find((item) => item.template === 'customer_confirmation')
      if (!email) throw new Error('customer_confirmation fixture missing')
      email.intro = 'Hej {totally_unknown}'
    })
    expect(() => validateCompleteDocument(introduced, persisted())).toThrow(
      'emails.customer_confirmation.sv.intro: Okänd platshållare {totally_unknown}.',
    )
  })
})
