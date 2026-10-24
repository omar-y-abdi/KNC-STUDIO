import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { PublicContent } from '../../src/worker'
import { PRESENTATION_RETRY_DELAYS_MS, readWithRetries } from '../../src/cms/NativeSurface'

// Homepage first load (R12): the shell paints only the background the app will paint, and the
// presentation read survives one slow database answer.
const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const shell = read('index.html')
const prePaint = (shell.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(/\s+/g, ' ')
const preloads = [...shell.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((match) =>
  match[0].replace(/\s+/g, ' '),
)

describe('homepage shell pre-paint', () => {
  it('hides the agent intro from scripted browsers only (PERF-3)', () => {
    expect(prePaint).toContain(
      '@media (scripting: enabled) { #root > main[aria-labelledby="public-intro-heading"] { display: none; } }',
    )
  })

  it('pre-paints the desktop panel surface the app paints, in both schemes (STY-3)', () => {
    expect(prePaint).toContain(
      '@media not all and (max-width: 768px) { html, body { background-color: #fff; } @media (prefers-color-scheme: dark) { html, body { background-color: #1c1c1e; } } }',
    )
  })

  it('pre-paints the mobile booking view like its panel (STY-3)', () => {
    expect(prePaint).toContain(
      'html[data-knc-view="booking"], html[data-knc-view="booking"] body { background-color: #fff; } @media (prefers-color-scheme: dark) { html[data-knc-view="booking"], html[data-knc-view="booking"] body { background-color: #1c1c1e; } }',
    )
  })

  it('preloads the hero fonts with CORS and the first-viewport icons as images (PERF-8, PERF-18)', () => {
    for (const font of ['PlayfairDisplay-Latin-400', 'PlayfairDisplay-Latin-700-Italic'])
      expect(preloads).toContain(
        `<link rel="preload" as="font" type="font/woff2" href="/fonts/${font}.woff2" crossorigin />`,
      )
    for (const icon of ['mappin.circle.fill', 'phone', 'sun.max', 'moon'])
      expect(preloads).toContain(`<link rel="preload" as="image" href="/icons/${icon}.svg" />`)
  })
})

function createEnv() {
  return {
    ASSETS: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const path = new URL(input instanceof Request ? input.url : input).pathname
        return path === '/index.html'
          ? new Response(shell, { headers: { 'Content-Type': 'text/html' } })
          : new Response('Not found', { status: 404 })
      },
    },
  }
}

async function nativeHtml(path: string): Promise<string> {
  const env = createEnv()
  const publicContent = new PublicContent({} as never, env)
  const response = await worker.fetch(
    new Request(`https://bladeblendstudio.se${path}`, { headers: { Accept: 'text/html' } }),
    env,
    { exports: { PublicContent: { fetch: (request: Request) => publicContent.fetch(request) } } },
  )
  expect(response.status).toBe(200)
  return response.text()
}

describe('native route root attribute', () => {
  it('marks the booking view so its pre-paint matches the booking panel', async () => {
    expect(await nativeHtml('/booking')).toMatch(/<html lang="sv" data-knc-view="booking"[\s>]/)
  })

  it.each(['/', '/about', '/my-bookings'])('leaves %s on the home pre-paint', async (path) => {
    expect(await nativeHtml(path)).not.toContain('data-knc-view')
  })
})

describe('presentation read retry (PERF-5)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const failure = (attempt: number): Error => new Error(`read ${attempt} failed`)

  it('pauses about 500 ms, then about 1,500 ms', () => {
    expect(PRESENTATION_RETRY_DELAYS_MS).toEqual([500, 1500])
  })

  it('returns the first successful read without pausing', async () => {
    const pause = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve())
    const readOnce = vi.fn(async () => 'presentation')
    await expect(
      readWithRetries(readOnce, [500, 1500], new AbortController().signal, pause),
    ).resolves.toBe('presentation')
    expect(readOnce).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
  })

  it('retries a failed read after the next pause', async () => {
    const pause = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve())
    const readOnce = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(failure(1))
      .mockResolvedValueOnce('presentation')
    await expect(
      readWithRetries(readOnce, [500, 1500], new AbortController().signal, pause),
    ).resolves.toBe('presentation')
    expect(readOnce).toHaveBeenCalledTimes(2)
    expect(pause.mock.calls.map(([ms]) => ms)).toEqual([500])
  })

  it('rejects with the last failure after one read per pause plus the first', async () => {
    const pause = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve())
    let attempt = 0
    const readOnce = vi.fn(async () => {
      throw failure(++attempt)
    })
    await expect(
      readWithRetries(readOnce, [500, 1500], new AbortController().signal, pause),
    ).rejects.toThrow('read 3 failed')
    expect(readOnce).toHaveBeenCalledTimes(3)
    expect(pause.mock.calls.map(([ms]) => ms)).toEqual([500, 1500])
  })

  it('starts no further read once the signal aborts during a pause', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const readOnce = vi.fn(async () => {
      throw failure(1)
    })
    const result = readWithRetries(readOnce, [500, 1500], controller.signal)
    const settled = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(200)
    controller.abort()
    await settled
    await vi.advanceTimersByTimeAsync(5000)
    expect(readOnce).toHaveBeenCalledTimes(1)
  })

  it('does not retry a read the signal aborted', async () => {
    const controller = new AbortController()
    const pause = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve())
    const readOnce = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(readWithRetries(readOnce, [500, 1500], controller.signal, pause)).rejects.toThrow(
      'aborted',
    )
    expect(readOnce).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
  })
})
