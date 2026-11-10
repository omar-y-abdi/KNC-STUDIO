import { hex, sha256Hex } from './encoding.ts'

/** Random enrollment capability; its digest is the only value persisted in the database. */
export function newStaffInvitationToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

export function hashStaffInvitationToken(token: string): Promise<string> {
  return sha256Hex(token)
}
