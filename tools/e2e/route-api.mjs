import { harnessOrigin } from './origins.mjs'

/**
 * Register API mocks on a Page or BrowserContext. Handlers retain Playwright's routing and
 * fallback order; only preflight and shared CORS headers belong here.
 * @param {Pick<import('@playwright/test').Page, 'route'>} page
 * @param {Array<[string | RegExp, (route: import('@playwright/test').Route,
 *   headers: Record<string, string>) => unknown]>} handlers
 */
export async function routeApi(page, handlers) {
  for (const [pattern, handler] of handlers) {
    await page.route(pattern, async (route) => {
      const requested = route.request().headers()
      const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': requested.origin ?? harnessOrigin,
        'Access-Control-Allow-Headers':
          requested['access-control-request-headers'] ??
          'authorization,apikey,content-type,x-client-info',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      return handler(route, headers)
    })
  }
}
