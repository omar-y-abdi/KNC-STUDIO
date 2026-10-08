import { mkdtempSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import { customerCmsFixture } from './cms-customer.mjs'

import { bounded, phase, assert } from './public-checks.mjs'

export async function customerStackFixture({ browserName }, use) {
  phase('customer: inspect local stack')
  console.log(`Customer fixture: ${browserName}`)
  const stack = JSON.parse(
    execFileSync('npx', ['supabase', 'status', '--output', 'json'], { encoding: 'utf8' }),
  )
  for (const value of [stack.API_URL, stack.DB_URL]) {
    assert(
      ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname),
      'customer browser gate requires loopback Supabase',
    )
  }
  const work = mkdtempSync(join(tmpdir(), 'knc-customer-e2e-'))
  const assets = join(work, 'dist'),
    key = join(work, 'localhost.key'),
    cert = join(work, 'localhost.crt')
  const port = Number(process.env.CUSTOMER_E2E_PORT ?? '4197')
  const workerPort = Number(process.env.CUSTOMER_E2E_WORKER_PORT ?? '8797')
  assert(
    Number.isInteger(port) && Number.isInteger(workerPort) && port !== workerPort,
    'distinct local test ports required',
  )
  const origin = `https://127.0.0.1:${port}`,
    workerOrigin = `https://127.0.0.1:${workerPort}`
  const secret =
    process.env.CUSTOMER_GATEWAY_SECRET ?? 'ci-customer-gateway-secret-not-for-production'
  const env = {
    ...process.env,
    VITE_SUPABASE_URL: `${origin}/__supabase`,
    LOCAL_SUPABASE_URL: stack.API_URL,
    VITE_SUPABASE_ANON_KEY: stack.ANON_KEY,
    VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    CUSTOMER_GATEWAY_PROXY_URL: workerOrigin,
    LOCAL_WORKER_DOCUMENTS: '1',
    LOCAL_HTTPS_KEY: key,
    LOCAL_HTTPS_CERT: cert,
  }
  let failed = false,
    failure
  const retainFailure = (error) => {
    if (!failed) {
      failed = true
      failure = error
    }
  }
  const children = []
  const stopChildren = () => {
    for (const child of children)
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          /* already stopped */
        }
      }
  }
  process.on('exit', stopChildren)
  const db = new Client({ connectionString: stack.DB_URL, connectionTimeoutMillis: 5000 })
  let connected = false
  const state = { fixture: undefined }
  let cms
  const upstream = createHttpServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const headers = new globalThis.Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined && !['host', 'connection', 'content-length'].includes(name)) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
      }
      const result = await fetch(`${stack.API_URL}${request.url}`, {
        method: request.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        redirect: 'manual',
      })
      response.statusCode = result.status
      const cookies = result.headers.getSetCookie()
      for (const [name, value] of result.headers) {
        if (
          ![
            'set-cookie',
            'content-encoding',
            'content-length',
            'transfer-encoding',
            'connection',
          ].includes(name)
        ) {
          response.setHeader(name, value)
        }
      }
      if (request.url?.startsWith('/functions/v1/')) {
        cookies.push(
          '__cf_bm=local-provider-fixture; HttpOnly; Secure; Path=/; Domain=supabase.co; Expires=Thu, 10 Sep 2037 22:19:54 GMT',
        )
      }
      if (cookies.length) response.setHeader('Set-Cookie', cookies)
      response.end(Buffer.from(await result.arrayBuffer()))
    } catch {
      response.statusCode = 502
      response.end('Local upstream unavailable')
    }
  })
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const removeQueuedMail = async (emails) =>
    db.query(
      `delete from public.external_action_jobs
    where action_type='customer_access_email_send' and payload->>'challenge_id' in (
      select id::text from public.customer_booking_access_challenges where email=any($1))`,
      [emails],
    )
  const cleanupFixture = async () => {
    if (!state.fixture) return
    await db.query('begin')
    try {
      await db.query('set local session_replication_role=replica')
      await removeQueuedMail(state.fixture.people.map((person) => person.email))
      for (const table of [
        'customer_booking_access_sessions',
        'customer_booking_access_challenges',
        'customer_booking_access_tokens',
      ]) {
        await db.query(`delete from public.${table} where email=any($1)`, [
          state.fixture.people.map((person) => person.email),
        ])
      }
      // This suite creates real bookings. Remove only its outbox/receipt children, including
      // those whose normal cascade is disabled by the fixture-cleanup transaction.
      await db.query(
        `delete from public.customer_booking_receipts where token_hash in (
        select r.receipt_hash from public.customer_booking_receipt_bookings r
        join public.bookings b on b.id=r.booking_id where b.barber_id=$1)`,
        [state.fixture.barber],
      )
      for (const table of [
        'customer_booking_receipt_bookings',
        'booking_email_delivery_jobs',
        'booking_reminders',
      ])
        await db.query(
          `delete from public.${table} where booking_id in (select id from public.bookings where barber_id=$1)`,
          [state.fixture.barber],
        )
      await db.query(
        `delete from public.external_action_jobs where payload->>'booking_id' in (select id::text from public.bookings where barber_id=$1)`,
        [state.fixture.barber],
      )
      if (state.fixture.attempts.length)
        await db.query('delete from public.booking_attempts where id=any($1)', [
          state.fixture.attempts,
        ])
      for (const table of ['bookings', 'services', 'barber_schedules'])
        await db.query(`delete from public.${table} where barber_id=$1`, [state.fixture.barber])
      await db.query('delete from public.barbers where id=$1', [state.fixture.barber])
      await db.query('commit')
      state.fixture = undefined
    } catch (error) {
      await db.query('rollback')
      throw error
    }
  }
  const start = (name, args, childEnv = process.env) => {
    const fd = openSync(join(work, `${name}.log`), 'w', 0o600)
    const child = spawn(process.execPath, args, {
      env: childEnv,
      detached: true,
      stdio: ['ignore', fd, fd],
    })
    closeSync(fd)
    children.push(child)
    return child
  }
  const ready = async (url, child, name) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      assert(
        child.exitCode === null,
        `${name} exited before readiness: ${readFileSync(join(work, `${name}.log`), 'utf8')}`,
      )
      const ok = await new Promise((resolveReady) => {
        const req = httpsRequest(url, { rejectUnauthorized: false }, (response) => {
          response.resume()
          resolveReady(response.statusCode === 200)
        })
        req.on('error', () => resolveReady(false))
        req.setTimeout(1000, () => req.destroy())
        req.end()
      })
      if (ok) return
      await delay(100)
    }
    throw new Error(`${name} did not become ready`)
  }

  try {
    await db.connect()
    connected = true
    await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen))
    const upstreamAddress = upstream.address()
    assert(
      upstreamAddress !== null && typeof upstreamAddress === 'object',
      'upstream test port missing',
    )
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
    phase('customer: build local frontend')
    execFileSync('npm', ['run', 'build', '--', '--outDir', assets, '--emptyOutDir'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    })
    const workerConfig = join(work, 'wrangler.jsonc')
    writeFileSync(
      workerConfig,
      JSON.stringify({
        name: 'knc-customer-browser',
        main: resolve('src/worker.ts'),
        compatibility_date: '2026-08-09',
        vars: { SUPABASE_URL: `http://127.0.0.1:${upstreamAddress.port}` },
        assets: {
          directory: assets,
          binding: 'ASSETS',
          run_worker_first: true,
          html_handling: 'none',
          not_found_handling: 'none',
        },
      }),
    )
    writeFileSync(
      join(work, '.dev.vars'),
      `SUPABASE_ANON_KEY=${stack.ANON_KEY}\nCUSTOMER_GATEWAY_SECRET=${secret}\n`,
      { mode: 0o600 },
    )
    phase('customer: start actual Worker and Vite preview')
    const worker = start('worker', [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--config',
      workerConfig,
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(workerPort),
      '--inspector-port',
      '0',
      '--local-protocol',
      'https',
      '--https-key-path',
      key,
      '--https-cert-path',
      cert,
      '--log-level',
      'error',
    ])
    const preview = start(
      'preview',
      [
        resolve('node_modules/vite/bin/vite.js'),
        'preview',
        '--outDir',
        assets,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      env,
    )
    await Promise.all([
      ready(`${workerOrigin}/robots.txt`, worker, 'worker'),
      ready(origin, preview, 'preview'),
    ])
    cms = await customerCmsFixture({ db, stack, origin, workerOrigin, work })
    await use({
      db,
      stack,
      origin,
      workerOrigin,
      work,
      cms,
      state,
      cleanupFixture,
      hash,
      removeQueuedMail,
    })
  } finally {
    upstream.closeAllConnections()
    await new Promise((resolveClose) => upstream.close(resolveClose))
    if (connected) {
      try {
        await cms?.cleanup()
      } catch (error) {
        retainFailure(error)
      }
      try {
        await cleanupFixture()
      } catch (error) {
        retainFailure(error)
      }
      try {
        await db.end()
      } catch (error) {
        retainFailure(error)
      }
    }
    stopChildren()
    const stopped = await Promise.allSettled(
      children.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : bounded(
              new Promise((resolveExit) => child.once('exit', resolveExit)),
              'local test server cleanup',
              5000,
            ),
      ),
    )
    for (const result of stopped)
      if (result.status === 'rejected') {
        retainFailure(result.reason)
        for (const child of children)
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {
              /* already stopped */
            }
          }
      }
    process.removeListener('exit', stopChildren)
    console.log(`Customer browser diagnostics: ${work}`)
  }
  if (failed) throw failure
}
