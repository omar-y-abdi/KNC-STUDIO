// Network guard for every browser test (PAR-12). Production is a live barbershop: a test that can
// reach bladeblendstudio.se or a *.supabase.co project can read or change real data. The guard
// refuses every host outside an explicit allowlist, covers HTTP requests, WebSockets and the
// APIRequestContext of each guarded browser context, and fails the test that attempted it.
//
// Test routes registered later on the same context or page take precedence over the guard, so a
// test may stub a foreign host (for example the Turnstile script) without reaching the network.

const LOCAL_HOSTS = ['127.0.0.1', 'localhost']
// Fake Supabase origin used by the harness builds; it never resolves.
const HARNESS_HOST = 'admin-harness.invalid'
// Refused even when named as the base URL or in the allowlist: nothing here may ever be reached.
const PRODUCTION_DOMAINS = ['bladeblendstudio.se', 'supabase.co']
const INERT_PROTOCOLS = new Set(['data:', 'blob:'])
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])
const API_REQUEST_METHODS = ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head']
const MAX_LISTED_VIOLATIONS = 20
const WEBSOCKET_POLICY_VIOLATION = 1008
const ALLOWED = Object.freeze({ allowed: true })

/**
 * Third-party hosts a test genuinely loads. Each entry names the Playwright groups that may reach
 * it (project metadata `group`) and the test that needs it. Everything else is blocked.
 */
export const THIRD_PARTY_ALLOWLIST = Object.freeze([
  Object.freeze({
    host: 'challenges.cloudflare.com',
    groups: Object.freeze(['customer']),
    reason:
      'customer.spec.mjs books through the real dialog, which loads Cloudflare Turnstile with the ' +
      'always-pass test site key (src/booking/Turnstile.tsx). Every other group stubs the widget.',
  }),
])

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl)
  } catch {
    // Not a URL at all: the caller turns this into an explicit 'unparseable-url' verdict.
    return null
  }
}

function bareHost(hostname) {
  return hostname.toLowerCase().replace(/\.+$/, '')
}

function isProductionHost(host) {
  return PRODUCTION_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function blocked(reason, host) {
  return { allowed: false, reason, host }
}

/** The origin allowlist for one test: fixed local hosts, the base URL host, and group entries. */
export function networkPolicy({ baseURL, group }) {
  const allowedHosts = new Set([...LOCAL_HOSTS, HARNESS_HOST])
  if (baseURL !== undefined) allowedHosts.add(bareHost(new URL(baseURL).hostname))
  for (const entry of THIRD_PARTY_ALLOWLIST)
    if (entry.groups.includes(group)) allowedHosts.add(entry.host)
  return Object.freeze({ baseURL, allowedHosts })
}

/**
 * Decide one URL. Total: every input yields `{ allowed: true }` or a blocked verdict with a reason
 * ('production-host' | 'foreign-host' | 'unsupported-scheme' | 'unparseable-url') and its host.
 */
export function judgeUrl(rawUrl, policy) {
  const url = parseUrl(rawUrl)
  if (url === null) return blocked('unparseable-url', '')
  if (INERT_PROTOCOLS.has(url.protocol)) return ALLOWED
  if (!NETWORK_PROTOCOLS.has(url.protocol)) return blocked('unsupported-scheme', url.hostname)
  const host = bareHost(url.hostname)
  if (isProductionHost(host)) return blocked('production-host', host)
  return policy.allowedHosts.has(host) ? ALLOWED : blocked('foreign-host', host)
}

// Query strings can carry keys or tokens; failure messages keep only the location.
function withoutQuery(rawUrl) {
  const url = parseUrl(rawUrl)
  if (url === null) return rawUrl
  url.search = ''
  url.hash = ''
  return url.href
}

function resolveAgainst(rawUrl, baseURL) {
  try {
    return new URL(rawUrl, baseURL).href
  } catch {
    // Unresolvable (relative URL without a base): judged as 'unparseable-url', which is blocked.
    return rawUrl
  }
}

function describeViolations(violations, policy) {
  const listed = violations
    .slice(0, MAX_LISTED_VIOLATIONS)
    .map(({ channel, method, url, reason }) => `  ${method} ${url} [${reason}] via ${channel}`)
  const hidden = violations.length - listed.length
  return [
    `e2e network guard: ${violations.length} request(s) to hosts outside the test allowlist were attempted and blocked:`,
    ...listed,
    ...(hidden > 0 ? [`  ... and ${hidden} more`] : []),
    `Allowed hosts: ${[...policy.allowedHosts].join(', ')}.`,
    'Stub the host with a test route, build the app against https://admin-harness.invalid, or add a ' +
      'commented entry to THIRD_PARTY_ALLOWLIST in tools/e2e/network-guard.mjs.',
  ].join('\n')
}

const guards = new WeakMap()

/** The guard attached to a context. Throws for a context that skipped the guarded fixtures. */
export function guardOf(context) {
  const guard = guards.get(context)
  if (guard === undefined)
    throw new Error(
      'This browser context was not created through the guarded fixtures (tools/e2e/fixtures.mjs): it has no network guard.',
    )
  return guard
}

/**
 * One guard per test. `attach(context)` makes a context safe; `assertClean()` fails the test when
 * anything was blocked. `takeViolations()` is for the guard's own spec only.
 */
export function createNetworkGuard(policy) {
  const violations = []
  const isBlocked = (url) => !judgeUrl(url.href, policy).allowed

  function record({ channel, method, url, reason }) {
    violations.push(Object.freeze({ channel, method, url: withoutQuery(url), reason }))
  }

  function blockRequest(route) {
    const request = route.request()
    const { reason } = judgeUrl(request.url(), policy)
    record({ channel: 'request', method: request.method(), url: request.url(), reason })
    return route.abort('blockedbyclient')
  }

  function blockWebSocket(socket) {
    const { reason } = judgeUrl(socket.url(), policy)
    record({ channel: 'websocket', method: 'GET', url: socket.url(), reason })
    return socket.close({
      code: WEBSOCKET_POLICY_VIOLATION,
      reason: 'Blocked by the e2e network guard',
    })
  }

  // page.request / context.request bypass browser routing, so their methods are wrapped directly.
  function guardApiRequest(apiRequest) {
    for (const method of API_REQUEST_METHODS) {
      const original = apiRequest[method].bind(apiRequest)
      apiRequest[method] = (target, options) => {
        const url = typeof target === 'string' ? target : target.url()
        const verdict = judgeUrl(resolveAgainst(url, policy.baseURL), policy)
        if (verdict.allowed) return original(target, options)
        record({
          channel: 'api-request',
          method: method.toUpperCase(),
          url,
          reason: verdict.reason,
        })
        return Promise.reject(
          new Error(
            `e2e network guard: APIRequestContext.${method} to ${withoutQuery(url)} is blocked [${verdict.reason}]`,
          ),
        )
      }
    }
  }

  async function attach(context) {
    if (guards.has(context)) return
    guards.set(context, guard)
    await context.route(isBlocked, blockRequest)
    await context.routeWebSocket(isBlocked, blockWebSocket)
    guardApiRequest(context.request)
  }

  const guard = Object.freeze({
    attach,
    guardApiRequest,
    record,
    get violations() {
      return [...violations]
    },
    takeViolations: () => violations.splice(0),
    assertClean() {
      if (violations.length > 0) throw new Error(describeViolations(violations, policy))
    },
  })
  return guard
}
