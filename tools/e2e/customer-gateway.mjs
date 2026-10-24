// The customer gateway (/api/customer-bookings) as the stored fixtures see it: which requests
// belong to it and which of its calls have a fixture answer. installStoredBackend routes with these.

/**
 * The customer gateway's answer for a visitor with no session, or undefined for a call this module
 * does not fixture. A page boot makes these two (src/app/App.tsx): `forget_device` for a visitor who
 * refused functional storage, and a `list` without a token that restores a returning customer.
 */
export function customerGatewayAnswer(payload) {
  if (payload?.action === 'forget_device') return { ok: true }
  if (payload?.action === 'list' && payload.accessToken === undefined)
    return { ok: false, error: 'access_denied' }
  return undefined
}

const CUSTOMER_GATEWAY_PATH = '/api/customer-bookings'

/** The gateway is matched by path: a query string must not slip past the route to the proxy. */
export function isCustomerGatewayUrl(url) {
  return url.pathname === CUSTOMER_GATEWAY_PATH
}
