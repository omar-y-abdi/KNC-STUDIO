export interface BookingAccessLink {
  readonly code: string | null
  readonly cleanPath: string
  /** Permanent tokens list directly; legacy one-time codes still exchange into a session. */
  readonly direct: boolean
}

export function consumeBookingAccessLink(href: string): BookingAccessLink {
  const url = new URL(href)
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const pathToken = url.pathname.match(/^\/([0-9a-f]{64})\/?$/i)?.[1] ?? null
  const fragmentToken = hashParams.get('booking_token')
  const legacyCode = hashParams.get('booking_access') ?? url.searchParams.get('booking_access')
  const code = pathToken ?? fragmentToken ?? legacyCode
  const direct = pathToken !== null || fragmentToken !== null

  url.searchParams.delete('booking_access')
  hashParams.delete('booking_token')
  hashParams.delete('booking_access')
  const remainingHash = hashParams.toString()

  return {
    code,
    cleanPath: `${pathToken === null ? url.pathname : '/'}${url.search}${remainingHash === '' ? '' : `#${remainingHash}`}`,
    direct,
  }
}
