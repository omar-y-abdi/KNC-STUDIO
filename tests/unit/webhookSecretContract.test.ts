import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const databaseDispatchers = [
  'supabase/migrations/20260813095925_durable_booking_email_delivery.sql',
  'supabase/migrations/20260813115438_durable_storage_cleanup.sql',
] as const

describe('webhook secret contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['external-cleanup', 'send-confirmation'] as const)(
    '%s accepts only the current shared Edge secret',
    async (name) => {
      vi.resetModules()
      let handler: ((request: Request) => Promise<Response>) | undefined
      const config: Record<string, string> = {
        BOOKING_WEBHOOK_SECRET: 'obsolete',
        SUPABASE_URL: 'https://db.example.test',
        SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
      }
      vi.stubGlobal('Deno', {
        env: { get: (key: string) => config[key] },
        serve: (callback: typeof handler) => {
          handler = callback
        },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('Unexpected network request')
        }),
      )
      await vi.importActual(`../../supabase/functions/${name}/index.ts`)
      if (!handler) throw new Error('Missing webhook handler')
      const request = (secret: string) =>
        new Request('https://edge.example.test/webhook', {
          method: 'POST',
          headers: { 'x-webhook-secret': secret },
          body: '{}',
        })
      const obsolete = await handler(request('obsolete'))
      expect(obsolete.status).toBe(name === 'external-cleanup' ? 401 : 503)
      config.WEBHOOK_SECRET = 'current'
      expect((await handler(request('obsolete'))).status).toBe(401)
      // Reaching payload validation proves the current secret was accepted, without delivery I/O.
      expect((await handler(request('current'))).status).toBe(400)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  // This is a cross-runtime deployment name: the SQL Vault key must match the Edge preflight.
  it('uses booking_webhook_secret as the database Vault key', () => {
    for (const path of databaseDispatchers) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).toContain("ds.name = 'booking_webhook_secret'")
      expect(source, path).not.toContain('BOOKING_WEBHOOK_SECRET')
    }
  })
})
