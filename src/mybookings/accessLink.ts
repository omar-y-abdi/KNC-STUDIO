export interface BookingAccessLink {
  readonly code: string | null
  readonly cleanPath: string
  /** Permanent tokens list directly; legacy one-time codes still exchange into a session. */
  readonly direct: boolean
  /** Separate mailbox-link proof. Null means a supplied but malformed proof; never a login token. */
  readonly emailLinkCode?: string | null
}

export function consumeBookingAccessLink(href: string): BookingAccessLink {
  const url = new URL(href)
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const pathToken = url.pathname.match(/^\/([0-9a-f]{64})\/?$/i)?.[1] ?? null
  const fragmentToken = hashParams.get('booking_token')
  const legacyCode = hashParams.get('booking_access') ?? url.searchParams.get('booking_access')
  const emailLinkCodes = hashParams.getAll('email_link')
  const hasEmailLink = emailLinkCodes.length > 0
  const emailLinkCode =
    emailLinkCodes.length === 1 && /^[0-9a-f]{64}$/i.test(emailLinkCodes[0] ?? '')
      ? (emailLinkCodes[0]?.toLowerCase() ?? null)
      : null
  // A mixed URL must not exchange another credential and silently switch the confirming account.
  const code = hasEmailLink ? null : (pathToken ?? fragmentToken ?? legacyCode)
  const direct = !hasEmailLink && (pathToken !== null || fragmentToken !== null)

  url.searchParams.delete('booking_access')
  hashParams.delete('booking_token')
  hashParams.delete('booking_access')
  hashParams.delete('email_link')
  const remainingHash = hashParams.toString()

  return {
    code,
    cleanPath: `${pathToken === null ? url.pathname : '/'}${url.search}${remainingHash === '' ? '' : `#${remainingHash}`}`,
    direct,
    ...(hasEmailLink ? { emailLinkCode } : {}),
  }
}
