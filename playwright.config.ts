import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

const group = process.env['E2E_GROUP'] ?? 'cms'
const artifacts = process.env['E2E_ARTIFACTS_ROOT'] ?? '.'
if (!['cms', 'public', 'startup', 'customer'].includes(group))
  throw new Error(`Unknown E2E group: ${group}`)
const harness = process.env['BASE_URL'] ?? 'http://127.0.0.1:4188'
const startup = process.env['CMS_STARTUP_URL'] ?? 'http://127.0.0.1:4189'
process.env['BASE_URL'] = harness
type BrowserName = 'chromium' | 'firefox' | 'webkit'
const cmsEngines: BrowserName[] = ['chromium', 'webkit']
const allEngines: BrowserName[] = ['chromium', 'firefox', 'webkit']
const projects: NonNullable<PlaywrightTestConfig['projects']> = [
  ...cmsEngines.map((browserName) => ({
    name: `cms-${browserName}`,
    testMatch: /cms-.*\.spec\.mjs/,
    testIgnore: /cms-startup\.spec\.mjs/,
    use: { browserName },
    metadata: { group: 'cms' },
  })),
  ...cmsEngines.map((browserName) => ({
    name: `startup-${browserName}`,
    testMatch: /cms-startup\.spec\.mjs/,
    use: { browserName, baseURL: startup },
    metadata: { group: 'startup' },
  })),
  ...allEngines.map((browserName) => ({
    name: `public-${browserName}`,
    testMatch:
      browserName === 'chromium'
        ? [
            'admin-state.spec.mjs',
            'admin-shared.spec.mjs',
            'public-smoke.spec.mjs',
            'visual.spec.mjs',
            'upload-budget.spec.mjs',
            'turnstile-layout.spec.mjs',
          ]
        : ['admin-shared.spec.mjs', 'turnstile-layout.spec.mjs'],
    use: { browserName },
    metadata: { group: 'public' },
  })),
  ...allEngines.map((browserName) => ({
    name: `customer-${browserName}`,
    testMatch: /customer\.spec\.mjs/,
    fullyParallel: false,
    timeout: 600_000,
    use: { browserName, ignoreHTTPSErrors: true },
    metadata: { group: 'customer' },
  })),
]
const shellArg = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const server = (command: string, url: string) => ({
  command,
  url,
  reuseExistingServer: !process.env['CI'],
  timeout: 60_000,
})
const devServer = {
  ...server(
    'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4188 --strictPort',
    `${harness}/tools/e2e/admin-harness.html`,
  ),
  env: {
    VITE_SUPABASE_URL: 'https://admin-harness.invalid',
    VITE_SUPABASE_ANON_KEY: 'e2e-public-anon-key',
    VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  },
}

export default defineConfig({
  testDir: './tools/e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: `${artifacts}/test-results`,
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  updateSnapshots: 'none',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['line'],
    ['json', { outputFile: `${artifacts}/test-results/results.json` }],
    ['html', { open: 'never', outputFolder: `${artifacts}/playwright-report` }],
  ],
  use: {
    baseURL: harness,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: projects.filter((project) => project.metadata?.['group'] === group),
  snapshotPathTemplate: `{testDir}/../visual/${process.platform === 'linux' ? 'baseline-linux' : 'baseline'}/{arg}{ext}`,
  webServer:
    group === 'cms'
      ? devServer
      : group === 'public'
        ? [
            devServer,
            server(
              `node node_modules/vite/bin/vite.js preview --outDir ${shellArg(process.env['E2E_PUBLIC_DIST'] ?? (process.env['RUNNER_TEMP'] ? `${process.env['RUNNER_TEMP']}/ci-build/public` : 'dist'))} --host 127.0.0.1 --port 4173 --strictPort`,
              'http://127.0.0.1:4173/',
            ),
          ]
        : group === 'startup'
          ? server(
              `node node_modules/vite/bin/vite.js preview --outDir ${shellArg(process.env['E2E_STARTUP_DIST'] ?? (process.env['RUNNER_TEMP'] ? `${process.env['RUNNER_TEMP']}/ci-build/startup` : 'dist-startup'))} --host 127.0.0.1 --port 4189 --strictPort`,
              startup,
            )
          : undefined,
})
