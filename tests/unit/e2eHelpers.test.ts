import { describe, expect, it, vi } from 'vitest'
import type { Page, Request, Route } from '@playwright/test'
import { assetFixture, barberFixture, documentFixture } from '../../tools/e2e/builders.mjs'
import { routeApi } from '../../tools/e2e/route-api.mjs'
import { harnessOrigin } from '../../tools/e2e/origins.mjs'

describe('e2e row builders', () => {
  it('creates independent documents and copies nested overrides', () => {
    const settings = { business_name: 'Owner copy' }
    const first = documentFixture({ settings })
    settings.business_name = 'Later edit'
    expect(first.settings.business_name).toBe('Owner copy')
    first.barbers.push(barberFixture())
    expect(documentFixture().barbers).toEqual([])
  })

  it('keeps explicit nullable and lifecycle asset overrides', () => {
    const asset = assetFixture({ width: null, archived: true, version: 7 })
    expect(asset).toMatchObject({
      bucket: 'cms-library',
      path: 'images/fixture.webp',
      width: null,
      height: 800,
      archived: true,
      trashed_at: null,
      version: 7,
    })
    expect(assetFixture()).toMatchObject({ archived: false, version: 0 })
  })

  it('uses the CMS barber row columns and preserves explicit empty copy', () => {
    const barber = barberFixture({ name: 'Owner barber', bio_sv: '', sort_order: 2 })
    expect(barber).toMatchObject({
      name: 'Owner barber',
      bio_sv: '',
      role_en: 'Barber',
      sort_order: 2,
    })
    expect(Object.keys(barber).sort()).toEqual([
      'bio_en',
      'bio_sv',
      'id',
      'ig',
      'name',
      'role_en',
      'role_sv',
      'sort_order',
    ])
    expect(barberFixture().id.length).toBeLessThanOrEqual(32)
  })
})

describe('routeApi', () => {
  const requestFor = (method: string, headers: Record<string, string> = {}) =>
    ({ method: () => method, headers: () => headers }) as unknown as Request
  const routeFor = (request: Request) => ({
    request: () => request,
    fulfill: vi.fn(),
    fallback: vi.fn(),
  })

  it('answers preflight with the requesting origin and explicit authorization headers', async () => {
    const page = {
      route: vi.fn<Page['route']>().mockResolvedValue({
        dispose: vi.fn(),
        [Symbol.asyncDispose]: vi.fn(),
      }),
    }
    const handler = vi.fn()
    await routeApi(page, [['**/api', handler]])
    const intercept = page.route.mock.calls[0]?.[1]
    if (!intercept) throw new Error('No registered route')
    const request = requestFor('OPTIONS', {
      origin: 'http://127.0.0.1:4788',
      'access-control-request-headers': 'authorization,x-owner-request',
    })
    const route = routeFor(request)
    await intercept(route as unknown as Route, request)
    expect(handler).not.toHaveBeenCalled()
    expect(route.fulfill).toHaveBeenCalledWith({
      status: 204,
      headers: expect.objectContaining({
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4788',
        'Access-Control-Allow-Headers': 'authorization,x-owner-request',
      }),
    })
  })

  it.each(['GET', 'POST'])(
    'retains %s handler order, original routes and fallback',
    async (method) => {
      const page = {
        route: vi.fn<Page['route']>().mockResolvedValue({
          dispose: vi.fn(),
          [Symbol.asyncDispose]: vi.fn(),
        }),
      }
      const handler = vi.fn((route: Route) => route.fallback())
      await routeApi(page, [
        ['**/first', handler],
        ['**/second', handler],
      ])
      expect(page.route.mock.calls.map(([pattern]) => pattern)).toEqual(['**/first', '**/second'])
      const intercept = page.route.mock.calls[0]?.[1]
      if (!intercept) throw new Error('No registered route')
      const request = requestFor(method)
      const route = routeFor(request)
      await intercept(route as unknown as Route, request)
      expect(handler).toHaveBeenCalledWith(
        route,
        expect.objectContaining({
          'Access-Control-Allow-Origin': harnessOrigin,
          'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
        }),
      )
      expect(route.fallback).toHaveBeenCalledOnce()
      expect(route.fulfill).not.toHaveBeenCalled()
    },
  )

  it('propagates a handler failure', async () => {
    const page = {
      route: vi.fn<Page['route']>().mockResolvedValue({
        dispose: vi.fn(),
        [Symbol.asyncDispose]: vi.fn(),
      }),
    }
    const failure = new Error('Fixture failed')
    await routeApi(page, [
      [
        '**/api',
        async () => {
          throw failure
        },
      ],
    ])
    const intercept = page.route.mock.calls[0]?.[1]
    if (!intercept) throw new Error('No registered route')
    const request = requestFor('POST')
    await expect(intercept(routeFor(request) as unknown as Route, request)).rejects.toBe(failure)
  })
})
