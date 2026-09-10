import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { changeOwnPassword, setNewPassword } from '../../src/admin/auth'
import { getAdminClient } from '../../src/admin/adminClient'
import { adminBackendReady, readAdminStackEnv } from './_adminHelpers'

describe.skipIf(!adminBackendReady())('Auth password policy (integration)', () => {
  it('requires the current password in the Settings change flow', async () => {
    const env = readAdminStackEnv()
    expect(env).not.toBeNull()
    if (!env) return

    const service = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const email = `password-policy-${Date.now()}@knc.test`
    const currentPassword = 'Current-Password-123A!'
    const nextPassword = 'Next-Password-456B!'
    const created = await service.auth.admin.createUser({
      email,
      password: currentPassword,
      email_confirm: true,
    })
    expect(created.error).toBeNull()
    const userId = created.data.user?.id
    expect(userId).toBeDefined()
    if (userId === undefined) return

    const admin = getAdminClient()
    try {
      const signedIn = await admin.auth.signInWithPassword({ email, password: currentPassword })
      expect(signedIn.error).toBeNull()
      const originalToken = signedIn.data.session?.access_token
      const rejected = await changeOwnPassword(email, 'Wrong-Password-999Z!', nextPassword)
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) expect(rejected.error.kind).toBe('auth')

      const changed = await changeOwnPassword(email, currentPassword, nextPassword)
      expect(changed.ok).toBe(true)
      expect((await admin.auth.getSession()).data.session?.access_token).toBe(originalToken)
      const refreshed = await admin.auth.refreshSession()
      expect(refreshed.error).toBeNull()
      expect(refreshed.data.user?.id).toBe(userId)

      const verifier = createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const oldCredential = await verifier.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      expect(oldCredential.error).not.toBeNull()
      const newCredential = await verifier.auth.signInWithPassword({
        email,
        password: nextPassword,
      })
      expect(newCredential.error).toBeNull()

      // Exercise the captured-JWT logout against real GoTrue, not only the browser SDK fixture.
      const reset = await setNewPassword('Reset-Password-789C!')
      expect(reset.ok).toBe(true)
      expect((await admin.auth.getSession()).data.session).toBeNull()
      const resetCredential = await verifier.auth.signInWithPassword({
        email,
        password: 'Reset-Password-789C!',
      })
      expect(resetCredential.error).toBeNull()
    } finally {
      await admin.auth.signOut({ scope: 'local' })
      await service.auth.admin.deleteUser(userId)
    }
  })
})
