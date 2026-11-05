import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import worker, { PublicContent } from '../../supabase/worker/index'

// The delivery log stores a copy of every app email and keeps it after its booking is deleted.
// The shipped privacy page is the static /privacy answer and the Studio seed of a missing CMS
// privacy page, so both language sections must describe that copy and its retention.
async function servedPrivacyPolicy(): Promise<string> {
  const env = {
    ASSETS: {
      fetch: async () =>
        new Response(readFileSync('public/privacy.html', 'utf8'), {
          headers: { 'Content-Type': 'text/html' },
        }),
    },
  }
  const content = new PublicContent({} as never, env)
  const response = await worker.fetch(new Request('https://salon.example.test/privacy'), env, {
    exports: { PublicContent: { fetch: (request: Request) => content.fetch(request) } },
  })
  expect(response.status).toBe(200)
  return (await response.text()).replace(/\s+/g, ' ')
}

describe('public privacy disclosure of stored email copies', () => {
  it('keeps the retention it states equal to the delivery log purge', () => {
    const migration = readFileSync(
      'supabase/migrations/20261028100000_email_send_log.sql',
      'utf8',
    ).replace(/\s+/g, ' ')
    expect(migration).toContain("where l.created_at < pg_catalog.now() - interval '30 days'")
    expect(migration).toContain("'email-send-log-purge', '29 3 * * *'")
    expect(migration).toContain('booking_id uuid references public.bookings(id) on delete set null')
  })

  it('describes the stored copy and its retention in Swedish', async () => {
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      '<p> När webbplatsen skickar ett mejl, till exempel en bokningsbekräftelse, påminnelse, ' +
        'avbokning eller åtkomstlänk, sparas en kopia i Supabase: mottagarens e-postadress, ' +
        'ämnesraden, mejlets innehåll som HTML och text, tidpunkten och om Resend tog emot mejlet. ' +
        'Inloggnings- och åtkomstlänkar ersätts med [dold länk] innan kopian sparas. Endast ' +
        'salongens ägare kan läsa kopiorna i webbplatsens administration, för att kontrollera och ' +
        'felsöka utskick. Varje kopia raderas automatiskt 30 dagar efter det första ' +
        'sändningsförsöket. Rensningen körs en gång per dygn, så en kopia kan finnas kvar upp till ' +
        'ett dygn längre. Raderas bokningen tidigare finns kopian kvar till dess, utan koppling ' +
        'till bokningen. </p>',
    )
    expect(privacy).toContain(
      'Sparade kopior av skickade mejl raderas automatiskt 30 dagar efter det första sändningsförsöket.',
    )
    expect(privacy).toContain('Senast uppdaterad 4 november 2026')
    expect(privacy).not.toContain('Senast uppdaterad 13 september 2026')
  })

  it('describes the stored copy and its retention in English', async () => {
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      '<p> When the website sends an email, for example a booking confirmation, reminder, ' +
        "cancellation or access link, a copy is stored in Supabase: the recipient's email " +
        'address, the subject line, the message content as HTML and text, the time, and whether ' +
        'Resend accepted the message. Sign-in and access links are replaced with [dold länk] ' +
        '(hidden link) before the copy is stored. Only the salon owner can read these copies in ' +
        "the website's administration, to check and troubleshoot delivery. Each copy is deleted " +
        'automatically 30 days after the first send attempt. The cleanup runs once a day, so a ' +
        'copy can remain up to one day longer. If the booking is deleted sooner, the copy remains ' +
        'until then without a link to the booking. </p>',
    )
    expect(privacy).toContain(
      'Stored copies of sent email are deleted automatically 30 days after the first send attempt.',
    )
    expect(privacy).toContain('Last updated 4 November 2026')
    expect(privacy).not.toContain('Last updated 13 September 2026')
  })
})
