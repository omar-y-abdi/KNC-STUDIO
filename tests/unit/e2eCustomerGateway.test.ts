import { describe, expect, it } from 'vitest'
import { customerGatewayAnswer, isCustomerGatewayUrl } from '../../tools/e2e/customer-gateway.mjs'

const gateway = (path: string) => new URL(path, 'http://127.0.0.1:4388')

describe('isCustomerGatewayUrl', () => {
  it('matches the gateway path with or without a query string or fragment', () => {
    expect(isCustomerGatewayUrl(gateway('/api/customer-bookings'))).toBe(true)
    expect(isCustomerGatewayUrl(gateway('/api/customer-bookings?probe=1'))).toBe(true)
    expect(isCustomerGatewayUrl(gateway('/api/customer-bookings#x'))).toBe(true)
  })

  it('leaves other paths alone', () => {
    expect(isCustomerGatewayUrl(gateway('/api/customer-bookings/extra'))).toBe(false)
    expect(isCustomerGatewayUrl(gateway('/api/cms/presentation'))).toBe(false)
  })
})

describe('customerGatewayAnswer', () => {
  it('answers the two calls a page boot makes', () => {
    expect(customerGatewayAnswer({ action: 'forget_device' })).toEqual({ ok: true })
    expect(customerGatewayAnswer({ action: 'list' })).toEqual({ ok: false, error: 'access_denied' })
  })

  it('answers nothing else', () => {
    expect(customerGatewayAnswer({ action: 'list', accessToken: '' })).toBeUndefined()
    expect(customerGatewayAnswer({ action: 'cancel', accessToken: 'sentinel' })).toBeUndefined()
    expect(customerGatewayAnswer(null)).toBeUndefined()
  })
})
