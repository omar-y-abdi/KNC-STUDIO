import { describe, expect, it } from 'vitest'
import {
  createCustomerAccessToken,
  customerAccessUrl,
  decryptCustomerAccessToken,
  encryptCustomerAccessToken,
  hashCustomerAccessToken,
  isCustomerAccessToken,
} from '../../supabase/functions/_shared/customerAccess'

const SECRET = 'test-customer-access-secret-that-is-long-enough'

describe('permanent customer access tokens', () => {
  it('creates high-entropy root-path-safe tokens and hashes them deterministically', async () => {
    const first = createCustomerAccessToken()
    const second = createCustomerAccessToken()
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toMatch(/^[0-9a-f]{64}$/)
    expect(second).not.toBe(first)
    expect(await hashCustomerAccessToken(first)).toBe(await hashCustomerAccessToken(first))
    expect(customerAccessUrl(first)).toBe(`https://bladeblendstudio.se/${first}`)
  })

  it('round-trips only with the correct encryption secret and rejects tampering', async () => {
    const token = createCustomerAccessToken()
    const ciphertext = await encryptCustomerAccessToken(token, SECRET)
    expect(ciphertext).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
    await expect(decryptCustomerAccessToken(ciphertext, SECRET)).resolves.toBe(token)
    await expect(
      decryptCustomerAccessToken(ciphertext, 'different-customer-access-secret-long-enough'),
    ).resolves.toBeNull()
    await expect(decryptCustomerAccessToken(`${ciphertext}x`, SECRET)).resolves.toBeNull()
  })

  it('rejects malformed tokens and weak encryption keys', async () => {
    expect(isCustomerAccessToken('not-a-token')).toBe(false)
    expect(() => customerAccessUrl('not-a-token')).toThrow('invalid customer access token')
    await expect(encryptCustomerAccessToken('a'.repeat(64), 'short')).rejects.toThrow(
      'invalid access token key',
    )
  })
})
