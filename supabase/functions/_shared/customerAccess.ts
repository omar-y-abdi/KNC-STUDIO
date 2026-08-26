const SITE_URL = 'https://bladeblendstudio.se'
const TOKEN = /^[0-9a-f]{64}$/
const CIPHERTEXT_PREFIX = 'v1.'
const KEY_CONTEXT = 'bladeblend/customer-access/aes-gcm/v1'
const AUTH_CONTEXT = new TextEncoder().encode('bladeblend/customer-access-token/v1')

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${KEY_CONTEXT}:${secret}`),
  )
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export function createCustomerAccessToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

export function isCustomerAccessToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value)
}

export async function hashCustomerAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return hex(new Uint8Array(digest))
}

export async function encryptCustomerAccessToken(token: string, secret: string): Promise<string> {
  if (!isCustomerAccessToken(token) || secret.length < 32)
    throw new Error('invalid access token key')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AUTH_CONTEXT },
    await encryptionKey(secret),
    new TextEncoder().encode(token),
  )
  const payload = new Uint8Array(iv.length + encrypted.byteLength)
  payload.set(iv)
  payload.set(new Uint8Array(encrypted), iv.length)
  return `${CIPHERTEXT_PREFIX}${base64Url(payload)}`
}

export async function decryptCustomerAccessToken(
  ciphertext: string,
  secret: string,
): Promise<string | null> {
  if (!ciphertext.startsWith(CIPHERTEXT_PREFIX) || secret.length < 32) return null
  const payload = fromBase64Url(ciphertext.slice(CIPHERTEXT_PREFIX.length))
  if (payload === null || payload.length <= 28) return null
  const iv = payload.slice(0, 12)
  const encrypted = payload.slice(12)
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AUTH_CONTEXT },
      await encryptionKey(secret),
      encrypted,
    )
    const token = new TextDecoder().decode(decrypted)
    return isCustomerAccessToken(token) ? token : null
  } catch {
    return null
  }
}

export function customerAccessUrl(token: string): string {
  if (!isCustomerAccessToken(token)) throw new Error('invalid customer access token')
  return `${SITE_URL}/${token}`
}
