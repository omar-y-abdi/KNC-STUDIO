/* global Request, Response */
// Real Worker output for browser tests of Worker-rendered CMS pages (TST-2, PAR-2). Playwright
// cannot import src/worker.ts directly (`cloudflare:workers`), so Vite's SSR loader runs the real
// TypeScript graph in the test process with the unit-test shim for that one module, as vitest does.
// Nothing is sent anywhere and no port is opened: the caller supplies the index.html shell and the
// published presentation, the Supabase calls are answered from them, and any other request the
// Worker makes fails the render.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../..', import.meta.url))
const SUPABASE = 'https://admin-harness.invalid'
const PRESENTATION_RPC = `${SUPABASE}/rest/v1/rpc/public_cms_presentation`
const DISCOVERY_RPC = `${SUPABASE}/rest/v1/rpc/public_business_discovery`
// An owner who has not filled in the business settings: the Worker renders the default business.
const DISCOVERY = { settings: {}, barbers: [], services: [], schedules: [] }

/** The production CSP from public/_headers, minus the https upgrade a loopback origin cannot use. */
export const productionCsp = (() => {
  const headers = readFileSync(join(root, 'public/_headers'), 'utf8')
  const policy = headers.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1]
  if (!policy) throw new Error('public/_headers has no Content-Security-Policy')
  return policy.replace(/;?\s*upgrade-insecure-requests/g, '')
})()

/** Load src/worker.ts once per test file; call `close()` in afterAll. */
export async function loadWorker() {
  const server = await createServer({
    root,
    // Worktree-local and git-ignored, like the dev server's own cache (vite.config.ts).
    cacheDir: join(root, '.vite-cache/cms-render'),
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: {
      alias: { 'cloudflare:workers': join(root, 'tests/unit/helpers/cloudflareWorkers.ts') },
    },
  })
  const worker = await server.ssrLoadModule('/src/worker.ts')
  return { worker, close: () => server.close() }
}

const urlOf = (input) => (input instanceof Request ? input.url : String(input))

function upstream(presentation, unexpected) {
  return async (input) => {
    const url = urlOf(input)
    if (url === PRESENTATION_RPC) return Response.json({ revision: 1, presentation })
    if (url === DISCOVERY_RPC) return Response.json(DISCOVERY)
    unexpected.push(url)
    throw new Error(`cms-render: unexpected upstream request ${url}`)
  }
}

// Static assets as Cloudflare serves them: the shell carries the headers from public/_headers.
function shellAssets(shell, unexpected) {
  return {
    async fetch(input) {
      const { pathname } = new URL(urlOf(input))
      if (pathname === '/index.html')
        return new Response(shell, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': productionCsp,
          },
        })
      unexpected.push(pathname)
      return new Response('Not found', { status: 404 })
    },
  }
}

async function render(worker, { url, presentation, shell }) {
  const unexpected = []
  const env = {
    SUPABASE_URL: SUPABASE,
    SUPABASE_ANON_KEY: 'e2e-public-anon-key',
    ASSETS: shellAssets(shell, unexpected),
  }
  const context = {
    exports: {
      PublicContent: { fetch: (request) => new worker.PublicContent({}, env).fetch(request) },
    },
  }
  const original = globalThis.fetch
  globalThis.fetch = upstream(presentation, unexpected)
  try {
    // The Worker routes by its production host name. The Request is only handed to the Worker's
    // fetch handler; nothing is sent, and every upstream call goes to the stub above.
    const { pathname, search } = new URL(url)
    const response = await worker.default.fetch(
      new Request(`https://bladeblendstudio.se${pathname}${search}`),
      env,
      context,
    )
    const body = await response.text()
    if (unexpected.length > 0)
      throw new Error(`cms-render: the Worker made unexpected requests: ${unexpected.join(', ')}`)
    return { status: response.status, headers: Object.fromEntries(response.headers), body }
  } finally {
    globalThis.fetch = original
  }
}

// The Worker reads the global fetch, so renders take turns owning it. A failed render still
// rejects for its caller; the queue only waits for it to settle.
let renders = Promise.resolve()
const settled = () => undefined

/**
 * The Worker's response for one public URL, with `presentation` as the published CMS document and
 * `shell` as the static index.html (a harness build's, or the repository's source shell).
 */
export function renderPublicDocument(worker, options) {
  const result = renders.then(() => render(worker, options))
  renders = result.then(settled, settled)
  return result
}

/** Serve the documents at `paths` on `origin` from the Worker; every other request passes on. */
export async function routeWorkerDocuments(page, { origin, paths, worker, presentation, shell }) {
  await page.route(
    (target) => target.origin === origin && paths.includes(target.pathname),
    async (route) => {
      const { status, headers, body } = await renderPublicDocument(worker, {
        url: route.request().url(),
        presentation,
        shell,
      })
      await route.fulfill({ status, headers, body })
    },
  )
}
