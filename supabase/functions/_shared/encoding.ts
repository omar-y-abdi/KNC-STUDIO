// Byte and digest encodings shared by the Edge Functions and the Worker's customer gateway.
// Web-standard globals only, so the module loads in Deno, workerd and Node/vitest alike.

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Lowercase hex SHA-256 of the UTF-8 text. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return hex(new Uint8Array(digest))
}
