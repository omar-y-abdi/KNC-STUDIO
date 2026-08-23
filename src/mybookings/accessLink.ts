export interface BookingAccessLink {
  readonly code: string | null
  readonly cleanPath: string
}

export function consumeBookingAccessLink(href: string): BookingAccessLink {
  const url = new URL(href)
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const code = hashParams.get('booking_access') ?? url.searchParams.get('booking_access')

  url.searchParams.delete('booking_access')
  hashParams.delete('booking_access')
  const remainingHash = hashParams.toString()

  return {
    code,
    cleanPath: `${url.pathname}${url.search}${remainingHash === '' ? '' : `#${remainingHash}`}`,
  }
}
