import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import {
  createSourceFile,
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
  ScriptTarget,
} from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { generate, parse as parseCss, walk, type CssNode } from 'css-tree'
import worker, { PublicContent } from '../../supabase/worker/index'
import {
  validatePresentation,
  type CmsPage,
  type CmsPresentation,
} from '../../packages/content-contracts/src/cms'
import { repairDesktopCss } from '../../packages/content-contracts/src/cms-device-css'
import {
  desktopRepaired,
  DesktopRepairUnavailable,
  hasLegacyDesktopCss,
  loadDesktopRepair,
  PRESENTATION_RETRY_DELAYS_MS,
  readWithRetries,
  type DesktopRepairLoad,
} from '../../modules/public-web/src/cms/NativeSurface'

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

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/

/** Each workspace of the root manifest by package name, with its directory and `exports` map. */
function workspaces(): Map<string, { dir: string; exports: Record<string, string> }> {
  const { workspaces: dirs } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    workspaces: string[]
  }
  return new Map(
    dirs.map((dir) => {
      const { name, exports } = JSON.parse(
        readFileSync(join(ROOT, dir, 'package.json'), 'utf8'),
      ) as {
        name: string
        exports?: Record<string, string>
      }
      return [name, { dir, exports: exports ?? {} }]
    }),
  )
}

/**
 * The repository files `entry` reaches through import and export declarations, and the bare
 * packages they name. A whole-clause `import type` / `export type` is erased by the compiler and is
 * not followed; every other declaration is, an inline `{ type X }` included (under
 * verbatimModuleSyntax it may survive as an import). `import()` is not followed: it is the edge to a
 * lazy chunk.
 */
function staticClosure(entry: string): { files: Set<string>; packages: Set<string> } {
  const manifests = workspaces()
  const files = new Set<string>()
  const bare = new Set<string>()
  const resolveFile = (from: string, specifier: string): string => {
    const base = normalize(join(dirname(from), specifier))
    const found = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']
      .map((suffix) => `${base}${suffix}`)
      .find((path) => existsSync(join(ROOT, path)) && statSync(join(ROOT, path)).isFile())
    if (found === undefined) throw new Error(`${from}: unresolved ${specifier}`)
    return found
  }
  const pending = [entry]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) continue
    files.add(file)
    if (!SCRIPT.test(file)) continue
    const source = createSourceFile(
      file,
      readFileSync(join(ROOT, file), 'utf8'),
      ScriptTarget.Latest,
    )
    for (const statement of source.statements) {
      if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue
      const erased = isImportDeclaration(statement)
        ? statement.importClause?.isTypeOnly === true
        : statement.isTypeOnly
      const specifier = statement.moduleSpecifier
      if (erased || specifier === undefined || !isStringLiteral(specifier)) continue
      const name = specifier.text
      if (name.startsWith('.')) {
        pending.push(resolveFile(file, name))
        continue
      }
      const segments = name.split('/')
      const packageName = segments.slice(0, name.startsWith('@') ? 2 : 1).join('/')
      const workspace = manifests.get(packageName)
      if (workspace === undefined) {
        bare.add(packageName)
        continue
      }
      const target = workspace.exports[`.${name.slice(packageName.length)}`]
      if (target === undefined) throw new Error(`${file}: ${name} is not exported`)
      pending.push(normalize(join(workspace.dir, target)))
    }
  }
  return { files, packages: bare }
}

describe('boot JavaScript (audit E 15a)', () => {
  it('reaches no css-tree through static imports from the public entry', () => {
    const { files, packages } = staticClosure('src/main.tsx')
    // The walk follows the public render path: the entry reaches the native surfaces and Preact.
    expect(files).toContain('modules/public-web/src/cms/NativeSurface.tsx')
    expect(files).toContain('modules/public-web/src/app/App.tsx')
    expect(packages).toContain('preact')
    expect(files).not.toContain('packages/content-contracts/src/cms-device-css.ts')
    expect(packages).not.toContain('css-tree')
  })
})

/** The rev-56 presentation the public browser suites serve: its /about en sheets carry the legacy
 * `@media (max-width:1440px)` rules. */
function storedPresentation(): CmsPresentation {
  const response: unknown = JSON.parse(
    gunzipSync(readFileSync(join(ROOT, 'tools/e2e/fixtures/presentation.json.gz'))).toString(
      'utf8',
    ),
  )
  if (!response || typeof response !== 'object' || !('presentation' in response))
    throw new Error('Invalid stored presentation')
  validatePresentation(response.presentation)
  return response.presentation
}

const SURFACE_PATHS = ['/', '/about', '/booking', '/my-bookings']

/** Every sheet a native surface renders (`useNativeSurface`), in page, language and mode order. */
function surfaceSheets(presentation: CmsPresentation): string[] {
  return presentation.pages
    .filter((page) => SURFACE_PATHS.includes(page.path))
    .flatMap((page) =>
      (['sv', 'en'] as const).flatMap((lang) =>
        (['light', 'dark'] as const).map((mode) => page.content[lang].css[mode]),
      ),
    )
}

function readyPresentation(presentation: CmsPresentation, load: DesktopRepairLoad) {
  const result = desktopRepaired(presentation, load)
  if (result.state !== 'ready' || result.presentation === null)
    throw new Error(`expected a ready presentation, got ${result.state}`)
  return result.presentation
}

/** `presentation` with the light sheet of one language of one page replaced. */
function withSheet(
  presentation: CmsPresentation,
  path: string,
  css: string,
  lang: 'sv' | 'en' = 'en',
): CmsPresentation {
  const replace = (page: CmsPage): CmsPage => {
    const content = { ...page.content }
    content[lang] = { ...page.content[lang], css: { ...page.content[lang].css, light: css } }
    return { ...page, content }
  }
  return {
    ...presentation,
    pages: presentation.pages.map((page) => (page.path === path ? replace(page) : page)),
  }
}

describe('Desktop breakpoint repair on demand (audit E 15a)', () => {
  const stored = storedPresentation()
  const loaded: DesktopRepairLoad = { state: 'loaded', repair: repairDesktopCss }
  const unavailable = new DesktopRepairUnavailable(new Error('chunk failed'))
  const about = (presentation: CmsPresentation): CmsPage => {
    const page = presentation.pages.find((candidate) => candidate.path === '/about')
    if (page === undefined) throw new Error('no /about page')
    return page
  }

  it('gives every surface sheet of the stored presentation the CSS the render-time repair gave', () => {
    expect(hasLegacyDesktopCss(stored)).toBe(true)
    const repaired = readyPresentation(stored, loaded)
    expect(surfaceSheets(repaired)).toEqual(
      surfaceSheets(stored).map((css) => repairDesktopCss(css)),
    )
    // The fixture really exercises the repair: both /about en sheets change and lose the breakpoint.
    for (const mode of ['light', 'dark'] as const) {
      expect(about(repaired).content.en.css[mode]).not.toBe(about(stored).content.en.css[mode])
      expect(about(repaired).content.en.css[mode]).not.toMatch(/max-width\s*:\s*1440px/)
    }
    // Everything else keeps its identity: other pages, and the Swedish /about variant.
    expect(about(repaired).content.sv).toBe(about(stored).content.sv)
    for (const [index, page] of repaired.pages.entries())
      if (page.path !== '/about') expect(page).toBe(stored.pages[index])
  })

  it('never offers the stored legacy sheets while the repair is missing or failed', () => {
    expect(desktopRepaired(stored, { state: 'missing' })).toEqual({ state: 'waiting' })
    expect(desktopRepaired(stored, { state: 'failed', error: unavailable })).toEqual({
      state: 'failed',
      error: unavailable,
    })
  })

  it('passes a presentation without legacy sheets through as the same object, without the repair', () => {
    const clean = readyPresentation(stored, loaded)
    expect(hasLegacyDesktopCss(clean)).toBe(false)
    const repair = vi.fn((css: string) => css)
    for (const load of [
      { state: 'missing' },
      { state: 'failed', error: unavailable },
      { state: 'loaded', repair },
    ] satisfies DesktopRepairLoad[]) {
      const result = desktopRepaired(clean, load)
      expect(result.state).toBe('ready')
      expect(result.state === 'ready' && result.presentation).toBe(clean)
    }
    expect(repair).not.toHaveBeenCalled()
    expect(desktopRepaired(null, { state: 'missing' })).toEqual({
      state: 'ready',
      presentation: null,
    })
  })

  it('ignores the breakpoint text on pages no native surface renders', () => {
    const clean = readyPresentation(stored, loaded)
    const created = clean.pages.find((page) => !SURFACE_PATHS.includes(page.path))
    if (created === undefined) throw new Error('the fixture has no page outside the surfaces')
    const presentation = withSheet(clean, created.path, '@media(max-width:1440px){#a{color:red}}')
    expect(hasLegacyDesktopCss(presentation)).toBe(false)
    const result = desktopRepaired(presentation, { state: 'missing' })
    expect(result.state === 'ready' && result.presentation).toBe(presentation)
  })

  it('skips css-tree only for sheets the repair returns unchanged', () => {
    const clean = readyPresentation(stored, loaded)
    const legacy = [
      '@media(max-width:1440px){#a{color:red}}',
      '@media (max-width: 1440px) {\n  #a {\n    color: red;\n  }\n}\n',
      '@media (max-width\n:\t1440px){#a{color:red}}',
    ]
    const sheets = [
      ...legacy,
      '@media (max-width:1440px){.a{color:red}}',
      '@media (MAX-WIDTH:1440px){#a{color:red}}',
      '@media (max-width:1440PX){#a{color:red}}',
      '@media (max-width:/**/1440px){#a{color:red}}',
      '@media (max-width:1441px){#a{color:red}}',
      '#a{max-width:1440px}',
      '',
      ...surfaceSheets(stored),
    ]
    for (const css of legacy) {
      expect(repairDesktopCss(css), css).not.toBe(css)
      expect(hasLegacyDesktopCss(withSheet(clean, '/about', css)), css).toBe(true)
      expect(hasLegacyDesktopCss(withSheet(clean, '/', css, 'sv')), css).toBe(true)
    }
    for (const css of sheets)
      if (!hasLegacyDesktopCss(withSheet(clean, '/about', css)))
        expect(repairDesktopCss(css), css).toBe(css)
  })

  it('loads the repair through the injected import and reports a failed load as typed data', async () => {
    const load = vi.fn(async () => ({ repairDesktopCss }))
    await expect(loadDesktopRepair(load)).resolves.toEqual({
      state: 'loaded',
      repair: repairDesktopCss,
    })
    expect(load).toHaveBeenCalledTimes(1)
    const cause = new TypeError('Failed to fetch dynamically imported module')
    const failed = await loadDesktopRepair(async () => {
      throw cause
    })
    expect(failed.state).toBe('failed')
    const error = failed.state === 'failed' ? failed.error : null
    expect(error).toBeInstanceOf(DesktopRepairUnavailable)
    expect(error?.cause).toBe(cause)
  })

  it('imports cms-device-css by default', async () => {
    const result = await loadDesktopRepair()
    if (result.state !== 'loaded') throw result.error
    const sheet = about(stored).content.en.css.light
    expect(result.repair(sheet)).toBe(repairDesktopCss(sheet))
  })
})
