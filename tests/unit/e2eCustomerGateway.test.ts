import { describe, expect, it, vi } from 'vitest'
import { createNetworkGuard, networkPolicy } from '../../tools/e2e/network-guard.mjs'
import { installPublicBackend, installStoredBackend } from '../../tools/e2e/public-fixtures.mjs'
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

const GATEWAY = 'http://127.0.0.1:4388/api/customer-bookings'

interface FakeGatewayRoute {
  request: () => { url: () => string; method: () => string; postDataJSON: () => unknown }
  fulfill: ReturnType<typeof vi.fn>
}
interface Registration {
  matches: unknown
  handle: (route: FakeGatewayRoute) => unknown
}

function gatewayRoute(url: string, payload: unknown): FakeGatewayRoute {
  return {
    request: () => ({ url: () => url, method: () => 'POST', postDataJSON: () => payload }),
    fulfill: vi.fn().mockResolvedValue(undefined),
  }
}

async function backendOf(install: 'installPublicBackend' | 'installStoredBackend') {
  const guard = createNetworkGuard(
    networkPolicy({ baseURL: 'http://127.0.0.1:4388', group: 'public' }),
  )
  const routes: Registration[] = []
  const context = {
    request: Object.fromEntries(
      ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'].map((name) => [name, vi.fn()]),
    ),
    addInitScript: vi.fn(),
    route: vi.fn(async (matches: unknown, handle: Registration['handle']) => {
      routes.push({ matches, handle })
    }),
    routeWebSocket: vi.fn(),
  }
  await guard.attach(context)
  await { installPublicBackend, installStoredBackend }[install](context)
  const gateway = routes.filter(
    ({ matches }) =>
      typeof matches === 'function' && (matches as (url: URL) => boolean)(new URL(GATEWAY)),
  )
  return { guard, gateway }
}

describe.each(['installPublicBackend', 'installStoredBackend'] as const)(
  '%s and the customer gateway',
  (install) => {
    it('registers one route that matches the gateway with or without a query string', async () => {
      const { gateway } = await backendOf(install)
      expect(gateway).toHaveLength(1)
      const matches = gateway[0]?.matches as (url: URL) => boolean
      expect(matches(new URL(`${GATEWAY}?probe=1`))).toBe(true)
    })

    it('answers the boot calls and refuses an unfixtured action with a guard record', async () => {
      const { guard, gateway } = await backendOf(install)
      const handle = gateway[0]?.handle as Registration['handle']
      const boot = gatewayRoute(`${GATEWAY}?probe=1`, { action: 'forget_device' })
      await handle(boot)
      expect(boot.fulfill).toHaveBeenCalledWith({ json: { ok: true } })
      expect(guard.violations).toEqual([])

      const cancel = gatewayRoute(`${GATEWAY}?probe=1`, {
        action: 'cancel',
        accessToken: 'sentinel',
      })
      await handle(cancel)
      expect(cancel.fulfill).toHaveBeenCalledWith({
        status: 501,
        json: { message: 'No public fixture for this call' },
      })
      expect(guard.violations).toEqual([
        {
          channel: 'request',
          method: 'POST',
          url: GATEWAY,
          reason:
            'unfixtured-harness-request (customer gateway action "cancel", fields: action, accessToken)',
        },
      ])
    })
  },
)
