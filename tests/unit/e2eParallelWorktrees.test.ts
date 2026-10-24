import type { PlaywrightTestConfig } from '@playwright/test'
import type { UserConfigFn } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveOrigins } from '../../tools/e2e/origins.mjs'

describe('resolveOrigins', () => {
  it('keeps the default ports and origins when no offset is set', () => {
    expect(resolveOrigins({})).toEqual({
      ports: { harness: 4188, public: 4173, startup: 4189 },
      harness: 'http://127.0.0.1:4188',
      public: 'http://127.0.0.1:4173',
      startup: 'http://127.0.0.1:4189',
    })
    expect(resolveOrigins({ E2E_PORT_OFFSET: '0' })).toEqual(resolveOrigins({}))
  })

  it('shifts all three ports and origins by the offset', () => {
    expect(resolveOrigins({ E2E_PORT_OFFSET: '100' })).toEqual({
      ports: { harness: 4288, public: 4273, startup: 4289 },
      harness: 'http://127.0.0.1:4288',
      public: 'http://127.0.0.1:4273',
      startup: 'http://127.0.0.1:4289',
    })
    expect(resolveOrigins({ E2E_PORT_OFFSET: '1000' }).ports).toEqual({
      harness: 5188,
      public: 5173,
      startup: 5189,
    })
  })

  it('lets an origin set in the environment win without moving the port of its server', () => {
    const origins = resolveOrigins({ E2E_PORT_OFFSET: '100', BASE_URL: 'http://127.0.0.1:5000' })
    expect(origins.harness).toBe('http://127.0.0.1:5000')
    expect(origins.ports.harness).toBe(4288)
    expect(origins.public).toBe('http://127.0.0.1:4273')
  })

  it.each([
    '',
    'abc',
    '-1',
    '1001',
    '1.5',
    '1e2',
    '0x10',
    '007',
    ' 7',
    '+7',
    '99999999999999999999',
  ])('rejects the offset %j with an error that names the variable', (text) => {
    expect(() => resolveOrigins({ E2E_PORT_OFFSET: text })).toThrow(
      /^E2E_PORT_OFFSET must be an integer from 0 to 1000, got /,
    )
  })

  it('gives concurrent runs 100 apart disjoint ports', () => {
    const ports = ['0', '100', '200', '300'].flatMap((offset) =>
      Object.values(resolveOrigins({ E2E_PORT_OFFSET: offset }).ports),
    )
    expect(new Set(ports).size).toBe(ports.length)
  })
})

const CONFIG_ENV = [
  'CI',
  'RUNNER_TEMP',
  'E2E_GROUP',
  'E2E_PORT_OFFSET',
  'E2E_PUBLIC_DIST',
  'E2E_STARTUP_DIST',
  'BASE_URL',
  'PUBLIC_BASE_URL',
  'CMS_STARTUP_URL',
] as const

async function loadPlaywrightConfig(
  env: Partial<Record<(typeof CONFIG_ENV)[number], string | undefined>>,
): Promise<PlaywrightTestConfig> {
  for (const name of CONFIG_ENV) vi.stubEnv(name, env[name])
  vi.resetModules()
  // playwright.config.ts is type-checked by tsconfig.node.json: load it by path and declare what it
  // exports, as customerAccessSecurityContract.test.ts does for vite.config.ts.
  const { default: config } = await vi.importActual<{ default: PlaywrightTestConfig }>(
    '../../playwright.config',
  )
  return config
}

function servers(config: PlaywrightTestConfig) {
  return [config.webServer ?? []].flat().map(({ command, url }) => ({
    port: /--port (\d+) --strictPort$/.exec(command)?.[1],
    url,
  }))
}

const HARNESS_PAGE = '/tools/e2e/admin-harness.html'

describe('playwright.config.ts', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    {
      group: 'cms',
      offset: undefined,
      expected: [{ port: '4188', url: `http://127.0.0.1:4188${HARNESS_PAGE}` }],
    },
    {
      group: 'public',
      offset: undefined,
      expected: [
        { port: '4188', url: `http://127.0.0.1:4188${HARNESS_PAGE}` },
        { port: '4173', url: 'http://127.0.0.1:4173/' },
      ],
    },
    {
      group: 'startup',
      offset: undefined,
      expected: [{ port: '4189', url: 'http://127.0.0.1:4189' }],
    },
    {
      group: 'cms',
      offset: '100',
      expected: [{ port: '4288', url: `http://127.0.0.1:4288${HARNESS_PAGE}` }],
    },
    {
      group: 'public',
      offset: '100',
      expected: [
        { port: '4288', url: `http://127.0.0.1:4288${HARNESS_PAGE}` },
        { port: '4273', url: 'http://127.0.0.1:4273/' },
      ],
    },
    {
      group: 'startup',
      offset: '100',
      expected: [{ port: '4289', url: 'http://127.0.0.1:4289' }],
    },
  ])('starts the $group servers at offset $offset on the derived ports', async (row) => {
    const config = await loadPlaywrightConfig({ E2E_GROUP: row.group, E2E_PORT_OFFSET: row.offset })
    expect(servers(config)).toEqual(row.expected)
  })

  it('publishes the origins to the workers through the environment', async () => {
    const config = await loadPlaywrightConfig({ E2E_PORT_OFFSET: '100' })
    expect(process.env['BASE_URL']).toBe('http://127.0.0.1:4288')
    expect(process.env['PUBLIC_BASE_URL']).toBe('http://127.0.0.1:4273')
    expect(process.env['CMS_STARTUP_URL']).toBe('http://127.0.0.1:4289')
    expect(config.use?.baseURL).toBe('http://127.0.0.1:4288')
  })

  it('points the startup projects at the startup origin', async () => {
    const config = await loadPlaywrightConfig({ E2E_GROUP: 'startup', E2E_PORT_OFFSET: '100' })
    expect(config.projects?.map((project) => project.use?.baseURL)).toEqual([
      'http://127.0.0.1:4289',
      'http://127.0.0.1:4289',
    ])
  })

  it('lets an origin set in the environment win while its server keeps the derived port', async () => {
    const config = await loadPlaywrightConfig({
      E2E_PORT_OFFSET: '100',
      BASE_URL: 'http://127.0.0.1:5000',
    })
    expect(process.env['BASE_URL']).toBe('http://127.0.0.1:5000')
    expect(config.use?.baseURL).toBe('http://127.0.0.1:5000')
    expect(servers(config)).toEqual([{ port: '4288', url: `http://127.0.0.1:5000${HARNESS_PAGE}` }])
  })

  it('refuses an invalid offset before any server starts', async () => {
    await expect(loadPlaywrightConfig({ E2E_PORT_OFFSET: 'abc' })).rejects.toThrow(
      'E2E_PORT_OFFSET must be an integer from 0 to 1000',
    )
  })
})

describe('vite.config.ts', () => {
  it('keeps the dependency cache in the worktree, not in the shared node_modules', async () => {
    const { default: config } = await vi.importActual<{ default: UserConfigFn }>(
      '../../vite.config',
    )
    const resolved = await config({ command: 'serve', mode: 'test' })
    expect(resolved.cacheDir).toBe('.vite-cache')
  })
})
