import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const edgeHandlers = [
  'supabase/functions/send-confirmation/index.ts',
  'supabase/functions/calendar-sync/index.ts',
  'supabase/functions/external-cleanup/index.ts',
] as const

const databaseDispatchers = [
  'supabase/migrations/20260813095925_durable_booking_email_delivery.sql',
  'supabase/migrations/20260813115438_durable_storage_cleanup.sql',
] as const

describe('webhook secret contract', () => {
  it('uses WEBHOOK_SECRET as the only Edge Function environment name', () => {
    for (const path of edgeHandlers) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).toContain("Deno.env.get('WEBHOOK_SECRET')")
      expect(source, path).not.toContain('BOOKING_WEBHOOK_SECRET')
      expect(source, path).toContain('timingSafeEqual')
    }
  })

  it('uses booking_webhook_secret as the database Vault key', () => {
    for (const path of databaseDispatchers) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).toContain("ds.name = 'booking_webhook_secret'")
      expect(source, path).not.toContain('BOOKING_WEBHOOK_SECRET')
    }
  })
})
