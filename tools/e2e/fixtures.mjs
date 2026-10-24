import { test as base } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { sourceIdentity } from '../ci/build-artifact.mjs'
import { createNetworkGuard, networkPolicy } from './network-guard.mjs'

// Browser/page/context lifetime, tracing and failure screenshots belong to Playwright.
// Product fixtures still own the controllable backend and race gates.
export const test = base.extend({
  // Automatic: every test is guarded without opting in. Requests to hosts outside the allowlist are
  // aborted when they happen, and the test fails when it attempted any (tools/e2e/network-guard.mjs).
  networkGuard: [
    async ({ baseURL }, use, info) => {
      const group = info.project.metadata?.group
      const guard = createNetworkGuard(networkPolicy({ baseURL, group }))
      await use(guard)
      guard.assertClean()
    },
    { auto: true },
  ],
  context: async ({ context, networkGuard }, use) => {
    await networkGuard.attach(context)
    await use(context)
  },
  request: async ({ request, networkGuard }, use) => {
    networkGuard.guardApiRequest(request)
    await use(request)
  },
  newContext: async ({ browser, networkGuard }, use) => {
    const contexts = []
    await use(async (options) => {
      const context = await browser.newContext(options)
      contexts.push(context)
      await networkGuard.attach(context)
      return context
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
  evidenceDir: async ({ baseURL, browserName }, use, info) => {
    const directory = info.outputPath('evidence')
    await mkdir(directory, { recursive: true })
    await writeFile(
      `${directory}/source.json`,
      JSON.stringify(
        {
          ...sourceIdentity(),
          browserName,
          baseURL,
          title: info.titlePath,
        },
        null,
        2,
      ),
    )
    await use(directory)
  },
})
export { expect, devices } from '@playwright/test'
