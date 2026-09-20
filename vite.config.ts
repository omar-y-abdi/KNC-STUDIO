import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import preact from '@preact/preset-vite'

function loopbackOrigin(value: string, name: string): string {
  const target = new URL(value)
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error(`${name} must be a loopback origin`)
  }
  return target.origin
}

// Hardened production build:
//  - no sourcemaps shipped (the "obscured" ceiling: minify + mangle, honestly stated)
//  - terser compress+mangle, comments stripped, console/debugger dropped
//  - opaque hashed asset names
//  - everything bundled from pinned local deps (no CDN, no runtime third-party)
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (command === 'build' && mode === 'production') {
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      if (!env[name]?.trim()) {
        throw new Error(`${name} is required: production must not use mock booking adapters`)
      }
    }
  }
  const target = loopbackOrigin(
    env['CUSTOMER_GATEWAY_PROXY_URL'] ?? 'http://127.0.0.1:8787',
    'CUSTOMER_GATEWAY_PROXY_URL',
  )
  const key = env['LOCAL_HTTPS_KEY']
  const cert = env['LOCAL_HTTPS_CERT']
  if (Boolean(key) !== Boolean(cert))
    throw new Error('Set both LOCAL_HTTPS_KEY and LOCAL_HTTPS_CERT')
  const https = key && cert ? { key: readFileSync(key), cert: readFileSync(cert) } : undefined
  const customerGateway: ProxyOptions = {
    target,
    // Preserve Host/Origin: the actual Worker must enforce the browser's same-origin boundary.
    changeOrigin: false,
    // Only loopback destinations are accepted above; local Worker certificates are self-signed.
    secure: false,
    configure(proxy) {
      proxy.on('proxyReq', (request, incoming) => {
        // Wrangler has no Cloudflare edge to supply this header. Never trust a browser override.
        request.setHeader('CF-Connecting-IP', incoming.socket.remoteAddress ?? '127.0.0.1')
      })
    },
  }
  const proxy: Record<string, ProxyOptions> = {
    '^/api/customer-bookings(?:\\?.*)?$': customerGateway,
    '^/api/bookings(?:\\?.*)?$': customerGateway,
    '^/api/cms/presentation(?:\\?.*)?$': customerGateway,
    '^/[0-9a-f]{64}(?:\\?.*)?$': customerGateway,
  }
  // Browser acceptance gate: serve public HTML from the actual local Worker at the same origin.
  if (env['LOCAL_WORKER_DOCUMENTS'] === '1')
    proxy['^/(?:about|booking|my-bookings|cms-public/source)?(?:\\?.*)?$'] = customerGateway
  // Optional local-only TLS bridge for browsers that reject HTTPS -> HTTP loopback fetches.
  // Supabase bearer auth still uses Authorization; site cookies belong only to our customer gateway.
  if (env['LOCAL_SUPABASE_URL']) {
    proxy['^/__supabase(?:/|$)'] = {
      target: loopbackOrigin(env['LOCAL_SUPABASE_URL'], 'LOCAL_SUPABASE_URL'),
      changeOrigin: true,
      secure: false,
      ws: true,
      rewrite: (path) => path.replace(/^\/__supabase/, ''),
      configure(upstream) {
        upstream.on('proxyReq', (request) => request.removeHeader('cookie'))
        upstream.on('proxyReqWs', (request) => request.removeHeader('cookie'))
        upstream.on('proxyRes', (response) => {
          delete response.headers['set-cookie']
        })
      },
    }
  }
  return {
    plugins: [preact()],
    server: { proxy, https },
    preview: { proxy, https },
    build: {
      target: 'es2022',
      sourcemap: false,
      minify: 'terser',
      cssMinify: true,
      terserOptions: {
        compress: { passes: 2, drop_console: true, drop_debugger: true },
        mangle: true,
        format: { comments: false },
      },
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[hash].js',
          chunkFileNames: 'assets/[hash].js',
          assetFileNames: 'assets/[hash][extname]',
        },
      },
    },
  }
})
