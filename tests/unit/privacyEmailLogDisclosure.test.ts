import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import worker, { PublicContent } from '../../src/worker'

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
      'sparas en kopia i Supabase: mottagarens e-postadress, ämnesraden, mejlets innehåll som HTML och text',
    )
    expect(privacy).toContain('ersätts med [dold länk] innan kopian sparas')
    expect(privacy).toContain('raderas automatiskt 30 dagar efter det första sändningsförsöket')
    expect(privacy).toContain(
      'Raderas bokningen tidigare finns kopian kvar till dess, utan koppling till bokningen',
    )
    expect(privacy).not.toContain('Senast uppdaterad 13 september 2026')
  })

  it('describes the stored copy and its retention in English', async () => {
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      "a copy is stored in Supabase: the recipient's email address, the subject line, the message content as HTML and text",
    )
    expect(privacy).toContain('replaced with [dold länk] before the copy is stored')
    expect(privacy).toContain('deleted automatically 30 days after the first send attempt')
    expect(privacy).toContain(
      'If the booking is deleted sooner, the copy remains until then without a link to the booking',
    )
    expect(privacy).not.toContain('Last updated 13 September 2026')
  })
})
