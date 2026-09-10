const IP_HEADER = 'x-customer-gateway-ip'
const TIME_HEADER = 'x-customer-gateway-time'
const SIGNATURE_HEADER = 'x-customer-gateway-signature'

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function message(ip: string, time: string, origin: string, body: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`customer-gateway/v1\n${ip}\n${time}\n${origin}\n${body}`)
}

export async function signCustomerGateway(
  secret: string,
  ip: string,
  origin: string,
  body: string,
): Promise<Record<string, string>> {
  const time = String(Date.now())
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    message(ip, time, origin, body),
  )
  return {
    [IP_HEADER]: ip,
    [TIME_HEADER]: time,
    [SIGNATURE_HEADER]: Array.from(new Uint8Array(signature), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  }
}

/** Unauthenticated clients cannot choose the IP bucket used by Turnstile and rate limits. */
export async function verifyCustomerGateway(
  req: Request,
  secret: string | undefined,
  body: string,
): Promise<string | null> {
  const ip = req.headers.get(IP_HEADER)
  const time = req.headers.get(TIME_HEADER) ?? ''
  const signature = req.headers.get(SIGNATURE_HEADER) ?? ''
  if (
    !secret ||
    secret.length < 32 ||
    !ip ||
    !/^[0-9a-fA-F:.]{3,45}$/.test(ip) ||
    !/^[0-9]{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 60_000 ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return null
  const bytes = Uint8Array.from(signature.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(secret),
    bytes,
    message(ip, time, req.headers.get('Origin') ?? '', body),
  )
  return valid ? ip : null
}
