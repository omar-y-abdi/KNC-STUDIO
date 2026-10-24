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

// The actions of PublicBookingAction (src/backend/publicBookingActions.ts). Only these names may
// appear in a failure message; whatever else a body carries is not echoed.
const GATEWAY_ACTIONS = [
  'request_link',
  'confirm_link',
  'forget_device',
  'request_access',
  'exchange_access',
  'list',
  'cancel',
  'review',
]

/**
 * Why the harness refused a gateway call, for the guard record. A posted body can carry an access
 * token, so the reason names the action only when it is a known string, and the fields by name.
 * @param {() => unknown} readPayload reads the request body as JSON; may throw with the body in its message
 * @returns {string}
 */
export function gatewayRefusalReason(readPayload) {
  let payload
  try {
    payload = readPayload()
  } catch {
    return 'unfixtured-harness-request (customer gateway body is not JSON)'
  }
  const action = payload?.action
  const label = GATEWAY_ACTIONS.includes(action)
    ? `action "${action}"`
    : typeof action === 'string'
      ? 'unknown action'
      : 'non-string action'
  const fields = Object.keys(payload ?? {}).join(', ')
  return `unfixtured-harness-request (customer gateway ${label}, fields: ${fields})`
}

/**
 * The fixture answer for a call, or undefined when there is none or the body cannot be read.
 * @param {() => unknown} readPayload
 */
export function gatewayAnswerOf(readPayload) {
  try {
    return customerGatewayAnswer(readPayload())
  } catch {
    return undefined
  }
}
