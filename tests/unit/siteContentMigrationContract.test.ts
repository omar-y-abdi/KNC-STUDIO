import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationName = readdirSync('supabase/migrations').find((name) =>
  name.endsWith('_update_confirm_sent_secure_link_copy.sql'),
)
const migration =
  migrationName === undefined ? '' : readFileSync(`supabase/migrations/${migrationName}`, 'utf8')

const oldCopy = {
  sv: 'En bokningsbekräftelse har skickats till {email}. Bokningen finns även under "Mina bokningar" via ditt telefonnummer.',
  en: 'A booking confirmation has been sent to {email}. You can also find the booking under "My appointments" using your phone number.',
} as const

const secureLinkCopy = {
  sv: 'En bokningsbekräftelse har skickats till {email}. Hantera bokningen via en säker länk under "Mina bokningar".',
  en: 'A booking confirmation has been sent to {email}. Manage the booking with a secure link under "My appointments".',
} as const

describe('confirmation copy migration', () => {
  it('updates only the known phone-lookup defaults and preserves owner-customized copy', () => {
    expect(migrationName).toBeDefined()
    expect(migration).toContain('update public.site_content')
    expect(migration).toContain("where key = 'confirmSent'")
    expect(migration).toContain(`value = '${oldCopy.sv}'`)
    expect(migration).toContain(`value = '${oldCopy.en}'`)
    expect(migration).toContain(`'${secureLinkCopy.sv}'`)
    expect(migration).toContain(`'${secureLinkCopy.en}'`)
    expect(migration).not.toContain('on conflict')
    expect(migration).not.toMatch(/update\s+public\.(barbers|services)/i)
  })
})
