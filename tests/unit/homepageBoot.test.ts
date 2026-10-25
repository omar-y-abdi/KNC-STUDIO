import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { generate, parse as parseCss, walk, type CssNode } from 'css-tree'
import worker, { PublicContent } from '../../src/worker'
import { PRESENTATION_RETRY_DELAYS_MS, readWithRetries } from '../../src/cms/NativeSurface'

// Homepage first load (R12): the shell paints only the background the app will paint, and the
// presentation read survives one slow database answer.
const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const shell = read('index.html')
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

/** Serve the actual shell through the native Worker route, with local assets only. */
async function nativeDocument(path: string): Promise<string> {
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

describe('homepage resource hints', () => {
  it('serves CORS-enabled hero font preloads and first-viewport image preloads', async () => {
    const html = await nativeDocument('/')
    const links: Record<string, string>[] = []
    const walk = (node: DefaultTreeAdapterMap['node']): void => {
      if ('tagName' in node && node.tagName === 'link')
        links.push(Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])))
      if ('childNodes' in node) node.childNodes.forEach(walk)
    }
    walk(parse(html))
    for (const font of ['PlayfairDisplay-Latin-400', 'PlayfairDisplay-Latin-700-Italic'])
      expect(links).toContainEqual(
        expect.objectContaining({
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: `/fonts/${font}.woff2`,
          crossorigin: '',
        }),
      )
    for (const icon of ['mappin.circle.fill', 'phone', 'sun.max', 'moon'])
      expect(links).toContainEqual(
        expect.objectContaining({ rel: 'preload', as: 'image', href: `/icons/${icon}.svg` }),
      )
  })
})

describe('booking pre-paint', () => {
  it('serves light and OS-dark booking surfaces in the native booking response', async () => {
    const html = await nativeDocument('/booking')
    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map((match) => match[1])
      .join('\n')
    const media: string[] = []
    const backgrounds: { media: string; color: string }[] = []
    walk(parseCss(css), {
      enter(node: CssNode) {
        if (node.type === 'Atrule' && node.name === 'media')
          media.push(node.prelude === null ? '' : generate(node.prelude))
        if (node.type !== 'Rule') return
        const selector = generate(node.prelude).replaceAll('"', "'")
        if (!selector.includes("[data-knc-view='booking']")) return
        walk(node.block, {
          visit: 'Declaration',
          enter(declaration) {
            if (declaration.property !== 'background-color') return
            const color = generate(declaration.value).replace(
              /^#([a-f0-9])([a-f0-9])([a-f0-9])$/i,
              '#$1$1$2$2$3$3',
            )
            backgrounds.push({ media: media.at(-1) ?? '', color })
          },
        })
      },
      leave(node: CssNode) {
        if (node.type === 'Atrule' && node.name === 'media') media.pop()
      },
    })
    expect(backgrounds).toEqual([
      { media: '', color: '#ffffff' },
      { media: '(prefers-color-scheme:dark)', color: '#1c1c1e' },
    ])
  })
})

describe('native route root attribute', () => {
  it('marks the booking view so its pre-paint matches the booking panel', async () => {
    expect((await nativeDocument('/booking')).match(/<html\b[^>]*>/)?.[0]).toBe(
      '<html lang="sv" data-knc-view="booking">',
    )
  })

  it.each(['/', '/about', '/my-bookings'])('leaves %s on the home pre-paint', async (path) => {
    expect((await nativeDocument(path)).match(/<html\b[^>]*>/)?.[0]).toBe('<html lang="sv">')
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
