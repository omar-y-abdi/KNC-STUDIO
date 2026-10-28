import { expect, it, vi } from 'vitest'

it.each(['public', 'admin'] as const)(
  '%s schemas construct and validate without dynamic code generation',
  async (entry) => {
    vi.resetModules()
    const { z } = await import('zod')
    const config = z.config()
    const previousJitless = Object.getOwnPropertyDescriptor(config, 'jitless')
    const attempts = vi.fn()
    const blockedFunction = new Proxy(globalThis.Function, {
      apply() {
        attempts()
        throw new EvalError('Dynamic code generation is forbidden by CSP')
      },
      construct() {
        attempts()
        throw new EvalError('Dynamic code generation is forbidden by CSP')
      },
    })

    try {
      // Zod shares config globally, even across fresh imports. Explicitly undo any earlier
      // configuration so removing the production config still fails if allowsEval was cached.
      z.config({ jitless: false })
      vi.stubGlobal('Function', blockedFunction)
      if (entry === 'public') {
        const { publicBusinessDiscoveryResponse } = await import('../../src/backend/rpcSchemas')
        expect(
          publicBusinessDiscoveryResponse.safeParse({
            settings: {},
            barbers: [],
            services: [],
            schedules: [],
          }).success,
        ).toBe(true)
        expect(
          publicBusinessDiscoveryResponse.safeParse({
            settings: { business_name: 7 },
            barbers: [],
            services: [],
            schedules: [],
          }).success,
        ).toBe(false)
      } else {
        // Import admin directly: its static parseWith re-export must configure the shared
        // dependency before this module constructs its first object schema.
        const { profileRow } = await import('../../src/admin/adminSchemas')
        const profile = {
          role: 'owner',
          barber_id: null,
          must_change_password: false,
          account_enabled: true,
        }
        expect(profileRow.safeParse(profile).success).toBe(true)
        expect(profileRow.safeParse({ ...profile, account_enabled: 'yes' }).success).toBe(false)
      }
      expect(z.config().jitless).toBe(true)
      expect(attempts).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      if (previousJitless) Object.defineProperty(config, 'jitless', previousJitless)
      else delete config.jitless
      vi.resetModules()
    }
  },
)
